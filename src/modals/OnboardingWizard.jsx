import { useState } from "react";
import { Activity, ChevronLeft, ShieldAlert, AlertTriangle } from "lucide-react";
import { INPUT_CLS, DISCLAIMER_VERSION, DISCLAIMER_URL } from "../constants";
import { SessionConfigurator } from "../components/SessionConfigurator";
import { GoalConfigurator } from "../components/GoalConfigurator";

// Guided first-run onboarding: Name -> Plan details -> Heart rate -> Health & safety.
// The health & safety acknowledgment is the LAST step and the only way out of
// onboarding (Skip jumps to it), so the user always sees the exciting setup first
// but can't reach the app without acknowledging the disclaimer. All input is held
// in local draft state and only committed via onComplete.
export function OnboardingWizard({settings, onSaveProgress, onComplete}) {
  const STEPS = 4;
  const HEALTH_STEP = STEPS - 1; // final, mandatory gate
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
  const [maxHRHint, setMaxHRHint] = useState("");

  // Final step — health & safety screening + medical/liability disclaimer. The
  // screening answer is GDPR special-category health data, so it's kept ONLY in
  // local state (never persisted); we persist only the acknowledgment record
  // (timestamp + disclaimer version) at completion via onComplete.
  const [screenApplies, setScreenApplies] = useState(null); // null | false | true
  const [ackChecked, setAckChecked] = useState(false);
  const [medConfirm, setMedConfirm] = useState(false);
  const flagged  = screenApplies === true;
  const answered = screenApplies !== null;
  const canPassHealth = answered && ackChecked && (!flagged || medConfirm);

  const trimmedName = name.trim();
  const plan = {raceDate, goalSec, distanceKm, raceElevation, planSessions};

  const ageN = parseInt(age) || 0;
  const tanakaMax  = ageN ? Math.round(208 - 0.7 * ageN) : null;

  const estimateHR = () => {
    if (!tanakaMax) { setMaxHRHint("Enter your age above to estimate it."); return; }
    setMaxHR(String(tanakaMax));
    setRestHR("60");
    setMaxHRHint("Estimated from age (Tanaka, 208 − 0.7×age): " + tanakaMax + " bpm max HR, with a typical 60 bpm resting HR.");
  };

  // Complete onboarding from the final health step. HR is included only if the
  // user actually entered any (so skipping the HR step leaves it unset).
  const complete = () => {
    const mhrN = parseInt(maxHR) || 0;
    const hasHR = ageN > 0 || mhrN > 0;
    const hr = hasHR ? {age: ageN, maxHR: mhrN || tanakaMax || 0, restHR: parseInt(restHR) || 60} : null;
    onComplete({name: trimmedName, plan, hr, healthAck: {v: DISCLAIMER_VERSION, at: new Date().toISOString()}});
  };

  // Conditions for the single combined screening question (placeholder wording —
  // have a qualified professional review before launch). Plain-language,
  // highest-risk PAR-Q items; a "yes" to any flags the consult-a-doctor warning.
  const healthItems = [
    "A heart condition, or a doctor has told you to do physical activity only under medical supervision",
    "Chest pain at rest, during daily activity, or during physical activity",
    "Dizziness, loss of balance, or loss of consciousness during or after exercise",
    "A bone or joint problem, or any other condition that running could make worse — or any other reason you should not do vigorous exercise",
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
        {step === HEALTH_STEP ? (
          // No skip on the final health & safety gate; it's the only exit.
          <span className="w-8"/>
        ) : (
          // "Skip" the optional setup — but funnel to the mandatory health step
          // rather than out of onboarding, so the gate can't be bypassed.
          <button onClick={() => goStep(HEALTH_STEP)}
            className="text-xs text-slate-400 hover:text-white transition-colors">
            Skip
          </button>
        )}
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
                <p className="text-sm text-slate-400 mt-1">What should we call you? (optional)</p>
              </div>
              <input autoFocus type="text" value={name} maxLength={40}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") goStep(1, {name: trimmedName}); }}
                placeholder="Your name"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm text-white text-center focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
              <button onClick={() => goStep(1, {name: trimmedName})}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                {trimmedName ? "Continue" : "Skip for now"}
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

              <div>
                {!(parseInt(maxHR) || 0) && (
                  <button type="button" onClick={estimateHR}
                    className="text-xs text-sky-300 hover:text-sky-200 underline underline-offset-2 transition-colors">
                    I don&apos;t know my heart rate
                  </button>
                )}
                {maxHRHint && <p className="text-xs text-slate-500 mt-1.5">{maxHRHint}</p>}
              </div>

              <button onClick={() => goStep(3)}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                Continue
              </button>
            </div>
          )}

          {step === 3 && (
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

              <button onClick={complete} disabled={!canPassHealth}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                Get started
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
