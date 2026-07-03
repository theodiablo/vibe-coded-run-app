import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { isNative } from "./native";
import { Activity, Calendar, TrendingUp, Plus, Loader, Trophy, Settings } from "lucide-react";
import { db, currentUserId } from "./db";
import { STORAGE_KEYS } from "./constants";
import { track } from "./telemetry";
import { buildPlan } from "./utils/plan";
import { computeBadges, unlockedIds } from "./utils/badges";
import { detectAnyRace, findEdition, editionLabel, loadCatalogue } from "./utils/races";
import { addRace, addEdition } from "./races";
import { deleteRoute, removePendingRoute, getAllRoutes, restoreRoutes, flushPendingRoutes } from "./routes";
import { flushPendingHr, hasHealthConnectAuthorization } from "./hr/healthconnect";
import { Toast } from "./components/Toast";
import { OnboardingWizard } from "./modals/OnboardingWizard";
import { BackupModal } from "./modals/BackupModal";
import { RestoreModal } from "./modals/RestoreModal";
import { SettingsModal } from "./modals/SettingsModal";
import { DeleteAccountModal } from "./modals/DeleteAccountModal";
import { RaceFormModal } from "./modals/RaceFormModal";
import { LiveRunTracker } from "./modals/LiveRunTracker";
import { Dashboard } from "./views/Dashboard";
import { PlanView } from "./views/PlanView";
import { LogView } from "./views/LogView";
import { RacesView } from "./views/RacesView";
import { ProgressView } from "./views/ProgressView";

// Lazy: pulls in react-markdown + remark-gfm (~47 KB gzipped) for rendering
// the coach's markdown replies. On the web that weight only belongs on the
// wire once someone actually opens the chat; on native the bundle already
// ships inside the app package, so the boot-time prefetch below (isNative
// branch) warms it immediately instead — a nearly-instant open with no
// web-only cost.
const CoachChat = lazy(() => import("./modals/CoachChat").then(m => ({ default: m.CoachChat })));

// In-app "review notification" helper (pure, module-level so it isn't a hook
// dependency): when a maintainer verifies one of the user's OWN catalogue
// contributions, we thank them once. `ackVerified` (in the personal blob, so it
// rides backup) records which verified ids we've already acknowledged. Returns
// the (possibly updated) races object plus the freshly-verified ids — the caller
// toasts. Seeds silently on the first reconcile so a pre-existing set never floods.
function computeVerifiedThanks(cat, racesObj, uid) {
  if (!uid) return { next: racesObj, fresh: [] };
  const mine = [];
  for (const r of cat) {
    if (r.createdBy === uid && r.verified) mine.push("race:" + r.slug);
    for (const e of r.editions || []) if (e.createdBy === uid && e.verified) mine.push("ed:" + e.id);
  }
  if (racesObj.ackVerified == null) return { next: { ...racesObj, ackVerified: mine }, fresh: [] };
  const fresh = mine.filter(id => !racesObj.ackVerified.includes(id));
  if (!fresh.length) return { next: racesObj, fresh: [] };
  return { next: { ...racesObj, ackVerified: [...racesObj.ackVerified, ...fresh] }, fresh };
}

export default function RunningCoach({ onSignOut }) {
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState("dash");
  const [runs,        setRuns]        = useState([]);
  const [plan,        setPlan]        = useState(null);
  const [settings,    setSettings]    = useState({
    raceDate:"", goalSec:"", distanceKm:"", raceElevation:0, name:"",
    age:0, maxHR:0, restHR:60, onboarded:false, onboardStep:0, intent:null,
    healthAck:null, hrMethod:"off", hrOptOut:false,
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
  // Always-fresh mirror of `races` so async callbacks (the boot catalogue load)
  // merge onto the latest state, not a stale snapshot captured before the user
  // could touch their races mid-load. Synced in an effect (the catalogue resolves
  // well after any concurrent change has committed).
  const racesRef = useRef(races);
  useEffect(() => { racesRef.current = races; }, [races]);
  // Native only: warm the lazy CoachChat chunk right after boot so opening the
  // coach feels instant — the JS is already local to the app package, so
  // fetching it early costs nothing. The web build deliberately skips this and
  // only fetches on first open, keeping the ~47 KB react-markdown dependency
  // off the initial page load.
  useEffect(() => { if (isNative) import("./modals/CoachChat"); }, []);
  // Freshest runs, for the foreground Health Connect HR retry below (an effect
  // with [] deps must read current runs from a ref, not a stale closure).
  const runsRef = useRef(runs);
  useEffect(() => { runsRef.current = runs; }, [runs]);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  // Shared race catalogue (fetched, NOT in the blob). [] until it loads / on a
  // failed fetch — the app renders regardless.
  const [catalogue,   setCatalogue]   = useState([]);
  const [showRaceForm,setShowRaceForm]= useState(false);
  const [showCoach,   setShowCoach]   = useState(false);
  // Stash from a "Set as target" promote → consumed by PlanView's setup form.
  const [planPrefill, setPlanPrefill] = useState(null);
  // Which Progress sub-tab to open, and a nonce so navigating there again (even
  // to the same sub-tab) re-applies it.
  const [progressSub,  setProgressSub]  = useState("log");
  const [progressNonce,setProgressNonce]= useState(0);

  // An optional `action` ({label, onClick}) turns the toast into an undoable one.
  const showToast = (msg, type, action) => setToast({msg, type: type || "ok", action});

  // Shared by both Health Connect HR retry points (boot + foreground) below, so
  // the relink logic can't drift between the two call sites. Applies the fetched
  // HR (or, for a run resolved some other way, just clears the marker) and
  // toasts only when a run actually gets filled in.
  const patchRunHr = (runId, patch) => {
    setRuns(prev => {
      const next = prev.map(x => x.id === runId ? { ...x, ...patch, hrPending: undefined } : x);
      db.set(STORAGE_KEYS.RUNS, next);
      return next;
    });
    if (patch.hr != null) showToast("Heart rate added to a run from Health Connect ❤");
  };

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
      // Load the shared catalogue WITHOUT blocking the splash: a slow/down
      // Supabase must not delay the app. On resolve, publish it and thank the
      // user for any of their contributions that a maintainer has since verified.
      loadCatalogue().then(cat => {
        setCatalogue(cat);
        // Merge onto the freshest races (racesRef), NOT the boot snapshot: the
        // user may have wishlisted/logged during the load, and that change must
        // not be clobbered by re-persisting a stale object.
        const cur = racesRef.current;
        const { next, fresh } = computeVerifiedThanks(cat, cur, currentUserId());
        if (next !== cur) { setRaces(next); db.set(STORAGE_KEYS.RACES, next); }
        if (fresh.length) {
          setToast({ type: "ok", msg: fresh.length === 1
            ? "Your race contribution was verified — thanks! 🎉"
            : fresh.length + " of your race contributions were verified — thanks! 🎉" });
        }
      });
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
      // Same deferred cleanup for Health Connect HR: a run saved before the watch
      // had synced its HR is stamped hrPending.
      // On boot, only open Health Connect if this *device* has previously granted
      // access. `settings.hrMethod` syncs across phones, so it is not enough to
      // prove the native bridge can be safely touched on this install.
      // Patch the loaded array directly instead of going through patchRunHr's
      // setRuns(prev => ...): React may not have committed setRuns(r) yet.
      // Actual relinks still run on foreground and when a run is saved.
      let bootRuns = r || [];
      const patchBootRunHr = (runId, patch) => {
        bootRuns = bootRuns.map(x => x.id === runId ? { ...x, ...patch, hrPending: undefined } : x);
        setRuns(bootRuns);
        db.set(STORAGE_KEYS.RUNS, bootRuns);
      };
      flushPendingHr(bootRuns, patchBootRunHr, {
        enabled: s?.hrMethod === "healthconnect",
        allowNativeRead: hasHealthConnectAuthorization(),
      }).catch(() => {});
    })();
  }, []);

  // Auto-dismiss the toast. setState here runs from a timer callback (not
  // synchronously in the effect body), and clears on unmount / re-show. An
  // actionable (undo) toast lingers longer so it can actually be tapped.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.action ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Health Connect HR often lands minutes after a run finishes (once the watch
  // syncs), so retry the deferred relink whenever the app returns to the
  // foreground — not only on cold start.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      flushPendingHr(runsRef.current, patchRunHr, { enabled: settingsRef.current.hrMethod === "healthconnect" }).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // patchRunHr only closes over stable setters — see the boot effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Re-apply done/skipped/runId from an old plan onto a freshly built one by
  // session id (ids are stable: w{n}d{dOff} for training, race-{editionId} for
  // races). Lets us add/remove a race without wiping weeks of progress.
  const carryProgress = (oldPlan, np) => {
    if (!oldPlan) return np;
    const flags = {};
    oldPlan.weeks.forEach(w => w.sessions.forEach(s => {
      flags[s.id] = { done: s.done, skipped: s.skipped, runId: s.runId };
    }));
    return { ...np, weeks: np.weeks.map(w => ({ ...w,
      sessions: w.sessions.map(s => {
        const f = flags[s.id];
        if (!f) return s;
        // skipped is a union, not an overwrite: the coach's cancel_session
        // marks skipped on the PROPOSAL, which must survive this re-stamp
        // (and a session the user skipped while the chat was open survives
        // the coach plan). done/runId stay client-owned overwrites.
        return { ...s, ...f, skipped: f.skipped || s.skipped };
      }) })) };
  };

  // Apply a coach-accepted plan. carryProgress re-stamps done/skipped/runId by
  // session id, so a session ticked while the chat was open isn't lost (the
  // coach tools never edit done sessions, so this can't undo an adjustment).
  // Deliberately NOT savePlan: that tracks "plan_generated" — this is an edit.
  const applyCoachPlan = p => {
    const merged = carryProgress(plan, p);
    setPlan(merged);
    db.set(STORAGE_KEYS.PLAN, merged);
  };

  // Toggle whether a wishlisted race is folded into the current plan. Persists the
  // flag and, if there's an active plan, rebuilds it preserving progress — so
  // adding a race shows up immediately without nuking completed sessions.
  const setRaceInPlan = (editionId, inPlan) => {
    const parts = (races.participations || []).map(p => p.editionId === editionId ? { ...p, inPlan } : p);
    saveRaces({ ...races, participations: parts });
    if (inPlan) track("plan_race_added");
    if (plan && settings.raceDate && settings.distanceKm) {
      const secRaces = parts
        .filter(p => p.status === "wishlist" && p.inPlan && p.editionId !== settings.targetEditionId)
        .map(p => ({ editionId: p.editionId, date: p.raceDate, distanceKm: p.distanceKm,
          elevation: findEdition(p.editionId)?.edition?.elevation || 0 }));
      const np = buildPlan(settings.raceDate, settings.goalSec, settings.planSessions,
        settings.distanceKm, settings.raceElevation,
        { recentRuns: runs, races: secRaces, mainEditionId: settings.targetEditionId ?? null });
      savePlan(carryProgress(plan, np));
    }
  };

  // Re-fetch + re-hydrate the catalogue (after a user contributes), so the new
  // entry shows immediately — contributions are instant + global.
  const refreshCatalogue = async () => { setCatalogue(await loadCatalogue()); };

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

  // Race-day auto-detect: when a just-saved run matches the date + distance of any
  // race on the plan (main or secondary), return the races object with that edition
  // marked done (plus the pre-change participations for Undo). `isMain` flags the
  // training target so the caller can prompt for the next race only then. null when
  // nothing matches.
  const detectCompletion = (added, baseRaces) => {
    // Candidate races = every RACE session on the plan carrying an editionId,
    // deduped. This covers the main race (stamped from targetEditionId) and any
    // secondary races; a hand-entered target has no editionId and stays undetected.
    const cands = [];
    const seen = new Set();
    (plan?.weeks || []).forEach(w => w.sessions.forEach(s => {
      if (s.type === "RACE" && s.editionId && !seen.has(s.editionId)) {
        seen.add(s.editionId);
        cands.push({ editionId: s.editionId, date: s.date, distanceKm: s.km });
      }
    }));
    // Fallback for plans built before RACE sessions carried editionId: detect the
    // main target off settings so existing users keep race-day auto-detect.
    if (settings.targetEditionId && settings.raceDate && settings.distanceKm && !seen.has(settings.targetEditionId)) {
      cands.push({ editionId: settings.targetEditionId, date: settings.raceDate, distanceKm: Number(settings.distanceKm) });
    }
    if (!cands.length) return null;
    let match = null, edId = null;
    for (const r of added) {
      const id = detectAnyRace(r, cands);
      if (id) { match = r; edId = id; break; }
    }
    if (!match) return null;
    const parts = baseRaces.participations || [];
    const prev = parts.find(p => p.editionId === edId) || null;
    if (prev?.status === "done") return null; // already logged — don't double-mark
    const joined = findEdition(edId);
    const ed = joined?.edition || { id: edId, date: match.date, distanceKm: match.km };
    const label = prev?.label || (joined ? editionLabel(joined, ed) : "your race");
    const snapshot = { editionId: edId, raceId: joined?.raceId, label, raceDate: ed.date, distanceKm: ed.distanceKm };
    const done = { ...(prev || snapshot), status: "done", timeSec: match.durationSec, runId: match.id, source: "auto", notes: prev?.notes || "" };
    const next = prev ? parts.map(p => p.editionId === edId ? done : p) : [...parts, done];
    return { nextRaces: { ...baseRaces, participations: next }, undoParts: parts, label, isMain: edId === settings.targetEditionId };
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
  const shared = {runs, plan, settings, races, catalogue, addRuns, savePlan, saveSettings, saveRaces, setRaceInPlan, promoteEdition, toggleSess, skipSess, buildPlan, exportData, deleteRun, updateRun, showToast, goTab: setTab, goLog, goProgress, openSettings: () => setShowSettings(true), openTracker: () => setShowTracker(true), openRaceForm: () => setShowRaceForm(true), openCoach: () => setShowCoach(true)};
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
        catalogue={catalogue} addRace={addRace} addEdition={addEdition}
        refreshCatalogue={refreshCatalogue} showToast={showToast}
        onSaveProgress={(partial, step) => saveSettings({...settings, ...partial, onboardStep: step})}
        onComplete={({name, plan, hr, healthAck}) => {
          // `plan` carries the race-shaped fields incl. targetEditionId (set when
          // a catalogue edition was picked, null otherwise). Clear the onboarding
          // scaffolding (onboardStep/intent) so it doesn't linger in the blob.
          const next = {...settings, name, onboarded: true, onboardStep: 0, intent: null, healthAck, ...plan, ...(hr || {})};
          saveSettings(next);
          // Only build a plan if the race was actually set up (the user may have
          // skipped straight to the health gate) — buildPlan needs date+distance.
          if (next.raceDate && next.distanceKm)
            savePlan(buildPlan(next.raceDate, next.goalSec, next.planSessions, next.distanceKm, next.raceElevation, {recentRuns: runs}));
          // A catalogue race picked in onboarding is the training target — also
          // surface it in the Races tab as a wishlist participation (the tab lists
          // participations, not the settings target). Skip if already present.
          const joined = findEdition(next.targetEditionId);
          if (joined && !(races.participations || []).some(p => p.editionId === next.targetEditionId)) {
            const ed = joined.edition;
            saveRaces({ ...races, participations: [...(races.participations || []), {
              editionId: ed.id, raceId: joined.raceId, label: editionLabel(joined, ed),
              raceDate: ed.date, distanceKm: ed.distanceKm,
              status: "wishlist", timeSec: null, runId: null, source: "onboarding", notes: "",
            }] });
          }
          setOnboarding(false);
          track("onboarding_completed");
        }}/>}
      {showTracker && <LiveRunTracker showToast={showToast} hrMethod={settings.hrMethod} hrOptOut={settings.hrOptOut}
        onConfigureHr={() => { setShowTracker(false); setShowSettings(true); }}
        onDeclineHr={() => saveSettings({ ...settings, hrOptOut: true })}
        onFinish={prefill => { setShowTracker(false); goLog(prefill); }}
        onClose={() => setShowTracker(false)}/>}
      {showBackup  && <BackupModal  data={{runs, plan, settings, races, ...(backupRoutes.length ? {routes: backupRoutes} : {})}} onClose={() => setShowBackup(false)}/>}
      {showRestore && <RestoreModal onRestore={handleRestore}     onClose={() => setShowRestore(false)}/>}
      {showSettings && <SettingsModal
        settings={settings} saveSettings={saveSettings} showToast={showToast}
        onBackup={()  => { setShowSettings(false); exportData(); }}
        onRestore={() => { setShowSettings(false); setShowRestore(true); }}
        onSignOut={onSignOut}
        onDeleteAccount={() => { setShowSettings(false); setShowDeleteAccount(true); }}
        onClose={()   => setShowSettings(false)}/>}
      {showDeleteAccount && <DeleteAccountModal
        onSignOut={onSignOut}
        onClose={() => setShowDeleteAccount(false)}/>}
      {showCoach && plan && (
        <Suspense fallback={<div className="fixed inset-0 bg-slate-900 z-50"/>}>
          <CoachChat plan={plan} onApplyPlan={applyCoachPlan}
            showToast={showToast} onClose={() => setShowCoach(false)}/>
        </Suspense>
      )}
      {showRaceForm && <RaceFormModal
        catalogue={catalogue} addRace={addRace} addEdition={addEdition}
        onContributed={refreshCatalogue} showToast={showToast}
        onClose={() => setShowRaceForm(false)}/>}

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
