import { useState } from "react";
import { Activity, ChevronLeft } from "lucide-react";
import { INPUT_CLS } from "../constants";
import { SessionConfigurator } from "../components/SessionConfigurator";
import { GoalConfigurator } from "../components/GoalConfigurator";

// Guided first-run onboarding: Name -> Plan details -> Heart rate.
// All input is held in local draft state and only committed via onComplete/onSkip.
export function OnboardingWizard({settings, onSaveProgress, onComplete, onSkip}) {
  const STEPS = 3;
  const [step, setStep] = useState(settings.onboardStep || 0);

  // Persist the entered data + the step we're moving to, so a refresh resumes
  // where the user left off (db flushes pending writes on page hide).
  const goStep = (next, partial) => { onSaveProgress(partial || {}, next); setStep(next); };

  const [name,          setName]    = useState(settings.name || "");
  const [raceDate,      setRaceDate] = useState(settings.raceDate || "");
  const [distanceKm,    setDist]    = useState(settings.distanceKm || "");
  const [raceElevation, setElev]    = useState(settings.raceElevation || 0);
  const [goalSec,       setGoal]    = useState(settings.goalSec || "");
  const [planSessions,  setSess]    = useState(settings.planSessions || [{dayOffset:2,minutes:30},{dayOffset:6,minutes:60}]);

  const [age,    setAge]    = useState(String(settings.age || ""));
  const [maxHR,  setMaxHR]  = useState(String(settings.maxHR || ""));
  const [restHR, setRestHR] = useState(String(settings.restHR || 60));
  const [hrMethod, setHrMethod] = useState(settings.hrMethod || "karvonen");

  const trimmedName = name.trim();
  const plan = {raceDate, goalSec, distanceKm, raceElevation, planSessions};

  const ageN = parseInt(age) || 0;
  const tanakaMax  = ageN ? Math.round(208 - 0.7 * ageN) : null;
  const classicMax = ageN ? 220 - ageN : null;

  const finish = withHR => {
    const mhrN = parseInt(maxHR) || 0;
    const hr = withHR
      ? {age: ageN, maxHR: mhrN || tanakaMax || 0, restHR: parseInt(restHR) || 60, hrMethod}
      : null;
    onComplete({name: trimmedName, plan, hr});
  };

  const methodOpts = [
    {v:"karvonen", l:"Karvonen (HRR)", sub:"Uses resting HR — more personalised"},
    {v:"pct",      l:"% of Max HR",    sub:"Simpler, doesn't need resting HR"},
  ];

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col">
      <header className="flex items-center justify-between px-4 border-b border-slate-800 shrink-0" style={{height:44}}>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <button onClick={() => goStep(step - 1)}
              className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-white transition-colors -ml-1 pr-1">
              <ChevronLeft size={16}/>Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {Array.from({length: STEPS}).map((_, i) => (
            <span key={i}
              className={"h-1.5 rounded-full transition-all " + (i === step ? "w-5 bg-orange-400" : "w-1.5 bg-slate-700")}/>
          ))}
        </div>
        <button onClick={() => onSkip({name: trimmedName})}
          className="text-xs text-slate-400 hover:text-white transition-colors">
          Skip
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-sm mx-auto p-5">
          <p className="text-xs text-slate-500 mb-4">{"Step " + (step + 1) + " of " + STEPS}</p>

          {step === 0 && (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-orange-500/15 flex items-center justify-center mx-auto">
                <Activity size={22} className="text-orange-400"/>
              </div>
              <div>
                <p className="font-bold text-lg">Welcome to Running Coach</p>
                <p className="text-sm text-slate-400 mt-1">What should we call you?</p>
              </div>
              <input autoFocus type="text" value={name} maxLength={40}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && trimmedName) goStep(1, {name: trimmedName}); }}
                placeholder="Your name"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm text-white text-center focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
              <button onClick={() => goStep(1, {name: trimmedName})} disabled={!trimmedName}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                Continue
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <p className="font-bold text-lg">Your race</p>
                <p className="text-sm text-slate-400 mt-1">Tell us about your goal and training days.</p>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Race date</label>
                <input type="date" value={raceDate} onChange={e => setRaceDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400"/>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Race distance (km)</label>
                <input type="number" min="1" max="200" step="0.1" value={distanceKm} placeholder="e.g. 21.1"
                  onChange={e => { const n = parseFloat(e.target.value); setDist(isNaN(n) ? "" : n); }}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Race elevation gain (m)</label>
                <input type="number" min="0" max="10000" step="10" value={raceElevation} placeholder="0"
                  onChange={e => { const v = e.target.value; setElev(v === "" ? "" : Math.max(0, parseInt(v) || 0)); }}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
                <p className="text-slate-500 text-xs mt-1">Total climb on the course — sets training paces to the flat-equivalent effort.</p>
              </div>
              <GoalConfigurator distanceKm={distanceKm} goalSec={goalSec} onChange={setGoal}/>
              <div>
                <label className="text-xs text-slate-400 block mb-2">Training days and durations</label>
                <SessionConfigurator sessions={planSessions} onChange={setSess}/>
              </div>
              <button onClick={() => goStep(2, {raceDate, goalSec, distanceKm, raceElevation, planSessions})} disabled={!raceDate || !distanceKm}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                Continue
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <p className="font-bold text-lg">Heart rate</p>
                <p className="text-sm text-slate-400 mt-1">Unlocks heart-rate targets on every session. Optional.</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs text-slate-400 block mb-1.5">Age</label>
                  <input type="number" min="10" max="90" placeholder="35" value={age} onChange={e => setAge(e.target.value)} className={INPUT_CLS}/></div>
                <div><label className="text-xs text-slate-400 block mb-1.5">Max HR</label>
                  <input type="number" min="100" max="230" placeholder="auto" value={maxHR} onChange={e => setMaxHR(e.target.value)} className={INPUT_CLS}/></div>
                <div><label className="text-xs text-slate-400 block mb-1.5">Rest HR</label>
                  <input type="number" min="30" max="120" placeholder="60" value={restHR} onChange={e => setRestHR(e.target.value)} className={INPUT_CLS}/></div>
              </div>

              {ageN > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">Max HR formulas — tap to apply:</p>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setMaxHR(String(tanakaMax))}
                      className="text-xs bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 px-3 py-2 rounded-lg transition-colors text-left">
                      <span className="font-semibold">{"Tanaka: " + tanakaMax + " bpm"}</span>
                      <span className="block opacity-70 text-xs">208 - 0.7×age · more accurate</span>
                    </button>
                    <button onClick={() => setMaxHR(String(classicMax))}
                      className="text-xs bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 px-3 py-2 rounded-lg transition-colors text-left">
                      <span className="font-semibold">{"Classic: " + classicMax + " bpm"}</span>
                      <span className="block text-slate-500 text-xs">220 - age · simple method</span>
                    </button>
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs text-slate-400 mb-2">Zone calculation method:</p>
                <div className="grid grid-cols-2 gap-2">
                  {methodOpts.map(opt => (
                    <button key={opt.v} onClick={() => setHrMethod(opt.v)}
                      className={"py-2.5 px-3 rounded-xl border text-left transition-colors " + (hrMethod === opt.v ? "bg-orange-500/15 border-orange-500/50 text-orange-300" : "bg-slate-700 border-slate-600 text-slate-400 hover:text-slate-300")}>
                      <p className="text-xs font-semibold">{opt.l}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{opt.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <button onClick={() => finish(true)}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                  Finish
                </button>
                <button onClick={() => finish(false)}
                  className="w-full border border-slate-500 hover:border-slate-300 text-slate-400 hover:text-white py-2.5 rounded-xl text-xs transition-colors">
                  I don't know my heart rate
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
