import { useState } from "react";
import { Activity, ChevronLeft, ShieldAlert, AlertTriangle, Search, Check, Target, Sparkles, MapPin, Trophy, Plus } from "lucide-react";
import { INPUT_CLS, DISCLAIMER_VERSION, DISCLAIMER_URL } from "../constants";
import { SessionConfigurator } from "../components/SessionConfigurator";
import { GoalConfigurator } from "../components/GoalConfigurator";
import { RaceFormModal } from "./RaceFormModal";
import { onboardingSteps } from "../utils/onboarding";
import { searchEditions, editionLabel, findEdition } from "../utils/races";
import { suggestedGoalSec } from "../utils/goal";
import { buildPlan } from "../utils/plan";
import { addWeeks, ymd, fmt } from "../utils/format";

// Guided first-run onboarding. The flow branches on the user's intent:
//   Welcome → Intent ─┬─ (race)   → Pick race → Goal & days ─┐
//                     └─ (fitness)→ Your training ───────────┤
//                                          → Heart rate → Health & safety → Summary
// The branch sequence is the pure `onboardingSteps(intent)`. The health & safety
// step is the mandatory gate and the only way into the app (header "Skip" jumps
// TO it, never around it); `summary` is an in-memory-only celebration after the
// gate. All input is held in local draft state and only committed via onComplete.
export function OnboardingWizard({settings, onSaveProgress, onComplete, catalogue, addRace, addEdition, refreshCatalogue, showToast}) {
  const today = ymd(new Date());

  const [intent, setIntent] = useState(settings.intent || null); // null | "race" | "fitness"
  const seq = onboardingSteps(intent);

  const [stepIdx, setStepIdx] = useState(() =>
    Math.min(Math.max(0, settings.onboardStep || 0), seq.length - 1));
  const cur = seq[stepIdx] || "welcome";

  // Shared draft — both branches funnel into the same race-shaped fields so the
  // summary and completion read them uniformly (the fitness branch synthesizes a
  // target date + distance + goal when leaving the training step).
  const [name,          setName] = useState(settings.name || "");
  const [raceDate,      setRaceDate] = useState(settings.raceDate || "");
  const [distanceKm,    setDist] = useState(settings.distanceKm || "");
  const [raceElevation, setElev] = useState(settings.raceElevation || 0);
  const [goalSec,       setGoal] = useState(settings.goalSec || "");
  const [planSessions,  setSess] = useState(settings.planSessions || [{dayOffset:2,minutes:30},{dayOffset:6,minutes:60}]);
  const [targetEditionId, setTargetEditionId] = useState(settings.targetEditionId);
  const [pickedLabel,   setPickedLabel] = useState(() => {
    const e = findEdition(settings.targetEditionId);
    return e ? editionLabel(e, e.edition) : "";
  });

  // Race-picker UI state.
  const [query,   setQuery]   = useState("");
  const [manual,  setManual]  = useState(false);
  const [showAddRace, setShowAddRace] = useState(false);

  // No-race ("get fit") branch picks. `selKey` tracks the chosen tile (so "5K"
  // and "Just run more" both map to 5 km but stay visually distinct).
  const [fitDist, setFitDist] = useState(5);
  const [selKey,  setSelKey]  = useState("5");
  const [horizon, setHorizon] = useState(12);

  // Heart rate (optional).
  const [age,    setAge]    = useState(String(settings.age || ""));
  const [maxHR,  setMaxHR]  = useState(String(settings.maxHR || ""));
  const [restHR, setRestHR] = useState(String(settings.restHR || 60));
  const [maxHRHint, setMaxHRHint] = useState("");

  // Final step — health & safety screening + disclaimer. The screening answer is
  // GDPR special-category health data, so it lives ONLY in local state and is
  // never persisted; we persist only the acknowledgment record (timestamp +
  // disclaimer version) at completion via onComplete.
  const [screenApplies, setScreenApplies] = useState(null); // null | false | true
  const [ackChecked, setAckChecked] = useState(false);
  const [medConfirm, setMedConfirm] = useState(false);
  const flagged  = screenApplies === true;
  const answered = screenApplies !== null;
  const canPassHealth = answered && ackChecked && (!flagged || medConfirm);

  const trimmedName = name.trim();
  const ageN = parseInt(age) || 0;
  const tanakaMax = ageN ? Math.round(208 - 0.7 * ageN) : null;

  // Navigate to a step by key. Persisted `onboardStep` is capped at the health
  // gate so `summary` is never persisted — a refresh on it resumes at the gate
  // and the acknowledgment is always captured fresh. `intent` is persisted too
  // so a mid-flow refresh rebuilds the right branch.
  const go = (key, partial = {}, nextIntent = intent) => {
    const ns = onboardingSteps(nextIntent);
    const idx = ns.indexOf(key);
    if (idx < 0) return;
    if (nextIntent !== intent) setIntent(nextIntent);
    setStepIdx(idx);
    onSaveProgress({...partial, intent: nextIntent}, Math.min(idx, ns.indexOf("health")));
  };
  const back = () => { if (stepIdx > 0) go(seq[stepIdx - 1]); };
  const skip = () => go("health");

  const estimateHR = () => {
    if (!tanakaMax) { setMaxHRHint("Enter your age above to estimate it."); return; }
    setMaxHR(String(tanakaMax));
    setRestHR("60");
    setMaxHRHint("Estimated from age (Tanaka, 208 − 0.7×age): " + tanakaMax + " bpm max HR, with a typical 60 bpm resting HR.");
  };

  // Pick a catalogue edition → autofill the race fields + set it as the training
  // target (mirrors RunningCoach's promoteEdition, but onboarding builds the plan
  // straight away so we set targetEditionId here).
  const pick = e => {
    setRaceDate(e.edition.date);
    setDist(e.edition.distanceKm);
    setElev(e.edition.elevation || 0);
    setTargetEditionId(e.edition.id);
    setPickedLabel(editionLabel(e, e.edition));
  };
  const clearPick = () => {
    setPickedLabel(""); setTargetEditionId(undefined);
    setRaceDate(""); setDist(""); setElev(0);
  };
  // Manual edits decouple from the catalogue (no targetEditionId → no auto-detect
  // against a now-irrelevant edition).
  const onManualEdit = () => { if (targetEditionId) { setTargetEditionId(undefined); setPickedLabel(""); } };

  // A race contributed to the catalogue from here becomes the training target:
  // feed it back into the same pick() path. The catalogue is already refreshed by
  // the modal, so findEdition resolves; if it lags, keep the typed values as-is.
  const onRaceCreated = editionId => {
    const j = findEdition(editionId);
    if (j) pick(j);
    setManual(false);
    setShowAddRace(false);
    showToast("Added to the catalogue — set as your race.");
  };

  // Leaving the no-race step: synthesize a race-shaped target so buildPlan has a
  // timeline. Goal comes from the mid-pack suggestion (always defined for a valid
  // distance) so paces are sensible without asking a beginner for a finish time.
  const finishTraining = () => {
    const g = suggestedGoalSec(fitDist) || "";
    const rd = addWeeks(horizon);
    setRaceDate(rd); setDist(fitDist); setGoal(g); setElev(0); setTargetEditionId(undefined); setPickedLabel("");
    go("hr", {raceDate: rd, distanceKm: fitDist, goalSec: g, raceElevation: 0, targetEditionId: null, planSessions});
  };

  // Complete from the summary. HR is included only if the user entered any.
  const complete = () => {
    const mhrN = parseInt(maxHR) || 0;
    const hasHR = ageN > 0 || mhrN > 0;
    const hr = hasHR ? {age: ageN, maxHR: mhrN || tanakaMax || 0, restHR: parseInt(restHR) || 60} : null;
    const plan = {raceDate, goalSec, distanceKm, raceElevation, planSessions, targetEditionId: targetEditionId || null};
    onComplete({name: trimmedName, plan, hr, healthAck: {v: DISCLAIMER_VERSION, at: new Date().toISOString()}});
  };

  const editionResults = searchEditions(query, today);

  // Plain-language, highest-risk PAR-Q items (placeholder wording — have a
  // qualified professional review before launch).
  const healthItems = [
    "A heart condition, or a doctor has told you to do physical activity only under medical supervision",
    "Chest pain at rest, during daily activity, or during physical activity",
    "Dizziness, loss of balance, or loss of consciousness during or after exercise",
    "A bone or joint problem, or any other condition that running could make worse — or any other reason you should not do vigorous exercise",
  ];

  const distOptions = [
    {km: 5,       label: "5K",   sub: "couch-to-5K friendly"},
    {km: 10,      label: "10K",  sub: "a solid next step"},
    {km: 21.0975, label: "Half", sub: "21.1 km"},
    {km: 5,       label: "Just run more", sub: "build the habit", key: "more"},
  ];

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col">
      <header className="flex items-center justify-between px-4 border-b border-slate-800 shrink-0" style={{height:44}}>
        <div className="flex items-center gap-2">
          {stepIdx > 0 && (
            <button onClick={back}
              className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-white transition-colors -ml-1 pr-1">
              <ChevronLeft size={16}/>Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {seq.map((_, i) => (
            <span key={i}
              className={"h-1.5 rounded-full transition-all " + (i === stepIdx ? "w-5 bg-orange-400" : "w-1.5 bg-slate-700")}/>
          ))}
        </div>
        {cur === "health" || cur === "summary" ? (
          <span className="w-8"/>
        ) : (
          // "Skip" the optional setup — but funnel to the mandatory health step
          // rather than out of onboarding, so the gate can't be bypassed.
          <button onClick={skip}
            className="text-xs text-slate-400 hover:text-white transition-colors">
            Skip
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-sm mx-auto p-5">
          <p className="text-xs text-slate-500 mb-4">{"Step " + (stepIdx + 1) + " of " + seq.length}</p>

          {cur === "welcome" && (
            <div className="text-center space-y-5">
              <div className="w-12 h-12 rounded-full bg-orange-500/15 flex items-center justify-center mx-auto">
                <Activity size={22} className="text-orange-400"/>
              </div>
              <div>
                <p className="font-bold text-lg">Welcome to Running Coach</p>
                <p className="text-sm text-slate-400 mt-1">A coach in your pocket — let&apos;s set you up in under a minute.</p>
              </div>
              <ul className="text-left space-y-2.5 bg-slate-800 rounded-2xl p-4">
                {[
                  {Icon: Target, t: "A training plan that adapts to your goal and your week"},
                  {Icon: MapPin, t: "Track every run live with GPS"},
                  {Icon: Trophy, t: "Earn badges as you build the habit"},
                ].map(({Icon, t}, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
                    <Icon size={16} className="text-orange-400 shrink-0 mt-0.5"/>{t}
                  </li>
                ))}
              </ul>
              <div className="space-y-2">
                <input autoFocus type="text" value={name} maxLength={40}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") go("intent", {name: trimmedName}); }}
                  placeholder="Your name (optional)"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm text-white text-center focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
                <button onClick={() => go("intent", {name: trimmedName})}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                  Get started
                </button>
              </div>
            </div>
          )}

          {cur === "intent" && (
            <div className="space-y-5">
              <div>
                <p className="font-bold text-lg">{trimmedName ? "Hi " + trimmedName + "! " : ""}What brings you here?</p>
                <p className="text-sm text-slate-400 mt-1">We&apos;ll tailor your plan to suit.</p>
              </div>
              <div className="space-y-3">
                <button onClick={() => go("race", {}, "race")}
                  className="w-full text-left bg-slate-800 rounded-2xl p-4 border border-slate-700 hover:border-orange-400/60 transition-colors flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center shrink-0">
                    <Trophy size={20} className="text-orange-400"/>
                  </div>
                  <div>
                    <p className="font-semibold">I&apos;m training for a race</p>
                    <p className="text-xs text-slate-400 mt-0.5">Pick your race and we&apos;ll build a plan that peaks on the day.</p>
                  </div>
                </button>
                <button onClick={() => go("training", {}, "fitness")}
                  className="w-full text-left bg-slate-800 rounded-2xl p-4 border border-slate-700 hover:border-orange-400/60 transition-colors flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center shrink-0">
                    <Sparkles size={20} className="text-orange-400"/>
                  </div>
                  <div>
                    <p className="font-semibold">I&apos;m just getting started</p>
                    <p className="text-xs text-slate-400 mt-0.5">No race yet — build fitness and the running habit at your pace.</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {cur === "race" && (
            <div className="space-y-5">
              <div>
                <p className="font-bold text-lg">Your race</p>
                <p className="text-sm text-slate-400 mt-1">Search the catalogue, or enter the details yourself.</p>
              </div>

              {!manual ? (
                pickedLabel ? (
                  <div className="bg-slate-800 rounded-2xl p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                      <Check size={18} className="text-emerald-400"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{pickedLabel}</p>
                      <p className="text-xs text-slate-400">{fmt.date(raceDate) + " · " + distanceKm + " km" + (raceElevation ? " · +" + raceElevation + "m" : "")}</p>
                    </div>
                    <button onClick={clearPick} className="text-xs text-slate-400 hover:text-white shrink-0">Change</button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                      <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search races, cities…"
                        className={INPUT_CLS + " pl-9"}/>
                    </div>
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {editionResults.slice(0, 25).map(e => (
                        <button key={e.edition.id} onClick={() => pick(e)}
                          className="w-full text-left bg-slate-800 rounded-xl border border-slate-700 px-4 py-3 hover:border-orange-400/50 transition-colors">
                          <p className="font-semibold truncate">{e.name}</p>
                          <p className="text-xs text-slate-400">{[e.city, e.country].filter(Boolean).join(", ") + " · " + fmt.date(e.edition.date) + " · " + e.edition.distanceKm + " km"}</p>
                        </button>
                      ))}
                      {editionResults.length === 0 && (
                        <div className="text-center py-4 space-y-2">
                          <p className="text-xs text-slate-500">No races match — enter yours manually below.</p>
                          <button onClick={() => setShowAddRace(true)} className="text-xs text-orange-400 hover:text-orange-300 font-semibold">
                            Add it to the catalogue →
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">Race date</label>
                    <input type="date" value={raceDate} onChange={e => { setRaceDate(e.target.value); onManualEdit(); }}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400"/>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">Race distance (km)</label>
                    <input type="number" min="1" max="200" step="0.1" value={distanceKm} placeholder="e.g. 21.1"
                      onChange={e => { const n = parseFloat(e.target.value); setDist(isNaN(n) ? "" : n); onManualEdit(); }}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">Race elevation gain (m)</label>
                    <input type="number" min="0" max="10000" step="10" value={raceElevation} placeholder="0"
                      onChange={e => { const v = e.target.value; setElev(v === "" ? "" : Math.max(0, parseInt(v) || 0)); onManualEdit(); }}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
                    <p className="text-slate-500 text-xs mt-1">Total climb on the course — sets training paces to the flat-equivalent effort.</p>
                  </div>
                  <button onClick={() => setShowAddRace(true)}
                    className="w-full flex items-center gap-3 text-left rounded-xl border border-dashed border-orange-400/50 bg-orange-500/10 hover:bg-orange-500/15 hover:border-orange-400 px-4 py-3 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
                      <Plus size={16} className="text-orange-300"/>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-orange-200">Add it to the catalogue</p>
                      <p className="text-xs text-slate-400">Help others find it — and we&apos;ll set it as your race.</p>
                    </div>
                  </button>
                </div>
              )}

              <button onClick={() => setManual(m => !m)} className="text-xs text-sky-300 hover:text-sky-200 underline underline-offset-2 transition-colors">
                {manual ? "Search the race catalogue instead" : "Enter a race manually instead"}
              </button>

              <button onClick={() => go("raceGoal", {raceDate, distanceKm, raceElevation, targetEditionId})} disabled={!raceDate || !distanceKm}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                Continue
              </button>
            </div>
          )}

          {cur === "raceGoal" && (
            <div className="space-y-5">
              <div>
                <p className="font-bold text-lg">Goal &amp; training days</p>
                <p className="text-sm text-slate-400 mt-1">A realistic target is pre-filled — tweak it if you like.</p>
              </div>
              <GoalConfigurator distanceKm={distanceKm} goalSec={goalSec} onChange={setGoal}/>
              <div>
                <label className="text-xs text-slate-400 block mb-2">Training days and durations</label>
                <SessionConfigurator sessions={planSessions} onChange={setSess}/>
              </div>
              <button onClick={() => go("hr", {goalSec, planSessions})}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                Continue
              </button>
            </div>
          )}

          {cur === "training" && (
            <div className="space-y-5">
              <div>
                <p className="font-bold text-lg">Your training</p>
                <p className="text-sm text-slate-400 mt-1">No race needed — pick a goal to build towards.</p>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-2">What do you want to build up to?</label>
                <div className="grid grid-cols-2 gap-2">
                  {distOptions.map(o => {
                    const id = o.key || String(o.km);
                    const selected = (selKey === id);
                    return (
                      <button key={id} onClick={() => { setSelKey(id); setFitDist(o.km); }}
                        className={"text-left rounded-xl border p-3 transition-colors " + (selected
                          ? "bg-orange-500/15 border-orange-500/60"
                          : "bg-slate-800 border-slate-700 hover:border-slate-600")}>
                        <p className="font-semibold text-sm">{o.label}</p>
                        <p className="text-xs text-slate-400">{o.sub}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-2">Over how long?</label>
                <div className="grid grid-cols-3 gap-2">
                  {[8, 12, 16].map(w => (
                    <button key={w} onClick={() => setHorizon(w)}
                      className={"py-2.5 rounded-xl border text-sm font-semibold transition-colors " + (horizon === w
                        ? "bg-orange-500 text-white border-orange-500"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:text-white")}>
                      {w} weeks
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-2">Training days and durations</label>
                <SessionConfigurator sessions={planSessions} onChange={setSess}/>
              </div>
              <button onClick={finishTraining}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                Continue
              </button>
            </div>
          )}

          {cur === "hr" && (
            <div className="space-y-5">
              <div>
                <p className="font-bold text-lg">Heart rate</p>
                <p className="text-sm text-slate-400 mt-1">Personalize your effort targets on every session. Optional — you can add this later.</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs text-slate-400 block mb-1.5">Age</label>
                  <input type="number" min="10" max="90" placeholder="35" value={age} onChange={e => setAge(e.target.value)} className={INPUT_CLS}/></div>
                <div><label className="text-xs text-slate-400 block mb-1.5">Max HR</label>
                  <input type="number" min="100" max="230" placeholder="auto" value={maxHR} onChange={e => setMaxHR(e.target.value)} className={INPUT_CLS}/></div>
                <div><label className="text-xs text-slate-400 block mb-1.5">Rest HR</label>
                  <input type="number" min="30" max="120" placeholder="60" value={restHR} onChange={e => setRestHR(e.target.value)} className={INPUT_CLS}/></div>
              </div>

              <div>
                {!(parseInt(maxHR) || 0) && (
                  <button type="button" onClick={estimateHR}
                    className="text-xs text-sky-300 hover:text-sky-200 underline underline-offset-2 transition-colors">
                    I don&apos;t know my heart rate
                  </button>
                )}
                {maxHRHint && <p className="text-xs text-slate-500 mt-1.5">{maxHRHint}</p>}
              </div>

              <button onClick={() => go("health")}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                Continue
              </button>
            </div>
          )}

          {cur === "health" && (
            <div className="space-y-5">
              <div className="text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-orange-500/15 flex items-center justify-center mx-auto">
                  <ShieldAlert size={22} className="text-orange-400"/>
                </div>
                <div>
                  <p className="font-bold text-lg">One last thing</p>
                  <p className="text-sm text-slate-400 mt-1">A quick safety check before you start. Your answer stays on this device and is not saved to your account.</p>
                </div>
              </div>

              <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
                <p className="text-sm text-slate-200">Do any of these apply to you?</p>
                <ul className="space-y-1.5">
                  {healthItems.map((item, i) => (
                    <li key={i} className="flex gap-2 text-xs text-slate-400">
                      <span className="text-orange-400 shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="grid grid-cols-2 gap-2 pt-0.5">
                  {[{v:false, l:"No, none apply"}, {v:true, l:"Yes, one or more"}].map(opt => (
                    <button key={opt.l} onClick={() => setScreenApplies(opt.v)}
                      className={"py-2.5 rounded-xl border text-sm font-semibold transition-colors " + (
                        screenApplies === opt.v
                          ? (opt.v ? "bg-red-500/15 border-red-500/50 text-red-300" : "bg-emerald-500/15 border-emerald-500/50 text-emerald-300")
                          : "bg-slate-700 border-slate-600 text-slate-400 hover:text-slate-200")}>
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

              {flagged && (
                <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5"/>
                    <div>
                      <p className="text-sm font-semibold text-red-200">Please talk to a doctor first</p>
                      <p className="text-xs text-red-200/80 mt-1">We strongly recommend you consult a physician before starting any training plan from this app. The plans here are general guidance, not medical advice, and may not be appropriate for your condition.</p>
                    </div>
                  </div>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={medConfirm} onChange={e => setMedConfirm(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded accent-orange-500 shrink-0"/>
                    <span className="text-xs text-red-100">I confirm I have consulted, or will consult, a doctor before I begin training with this app.</span>
                  </label>
                </div>
              )}

              {/* Medical / liability disclaimer — PLACEHOLDER copy, pending review
                  by a qualified lawyer before launch. Do not treat as final. */}
              <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
                <p className="text-sm font-semibold text-slate-200">Health &amp; safety disclaimer</p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Running Coach provides general training information only — it is
                  not medical advice and is no substitute for professional
                  guidance. Physical activity carries inherent risks, including
                  injury and, in rare cases, serious cardiac events. You take part
                  at your own risk and are responsible for training within your own
                  limits and stopping if you feel unwell. Consult a physician before
                  beginning this or any exercise programme. Nothing in this notice
                  excludes or limits any liability that cannot be excluded or
                  limited under applicable law.
                </p>
                <a href={DISCLAIMER_URL} target="_blank" rel="noopener noreferrer"
                  className="inline-block text-xs text-orange-400 hover:text-orange-300">
                  Read the full disclaimer
                </a>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={ackChecked} onChange={e => setAckChecked(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded accent-orange-500 shrink-0"/>
                  <span className="text-xs text-slate-200">I have read and accept the health &amp; safety disclaimer above.</span>
                </label>
              </div>

              <button onClick={() => go("summary")} disabled={!canPassHealth}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                Continue
              </button>
            </div>
          )}

          {cur === "summary" && (() => {
            const preview = buildPlan(raceDate, goalSec, planSessions, distanceKm, raceElevation);
            const weeks = preview?.weeks?.length || 0;
            const label = pickedLabel || (intent === "fitness" ? "Build your base" : "Your race");
            return (
              <div className="space-y-5 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
                  <Check size={24} className="text-emerald-400"/>
                </div>
                <div>
                  <p className="font-bold text-lg">You&apos;re all set{trimmedName ? ", " + trimmedName : ""}!</p>
                  <p className="text-sm text-slate-400 mt-1">Here&apos;s the plan we&apos;ve built for you.</p>
                </div>
                <div className="bg-slate-800 rounded-2xl p-4 space-y-3 text-left">
                  <div className="flex items-center gap-3">
                    <Target size={18} className="text-orange-400 shrink-0"/>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{label}</p>
                      <p className="text-xs text-slate-400">{(intent === "fitness" ? "Goal " : "") + distanceKm + " km · " + fmt.date(raceDate)}</p>
                    </div>
                  </div>
                  <div className="border-t border-slate-700/50 pt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xl font-bold text-orange-300">{weeks}</p>
                      <p className="text-xs text-slate-400">week plan</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold text-orange-300">{planSessions.length}</p>
                      <p className="text-xs text-slate-400">sessions / week</p>
                    </div>
                  </div>
                </div>
                <button onClick={complete}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                  Get started
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {showAddRace && <RaceFormModal
        catalogue={catalogue} addRace={addRace} addEdition={addEdition}
        onContributed={refreshCatalogue} showToast={showToast}
        prefill={{date: raceDate, distanceKm, elevation: raceElevation}}
        onCreated={onRaceCreated}
        onClose={() => setShowAddRace(false)}/>}
    </div>
  );
}
