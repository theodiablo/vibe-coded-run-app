import { useEffect, useState } from "react";
import { fmt } from "../utils/format";
import { paceBand, suggestedGoalSec, clampGoalSec } from "../utils/goal";

// Goal-setting control shared by onboarding and the plan view. A single slider
// sets either the finish time or the pace (toggle), and its range adapts to the
// entered distance so it only ever offers realistic finish times. The unset/out
// -of-band goal is normalised to a suggestion and pushed up via onChange so the
// parent always holds a real value.
export function GoalConfigurator({distanceKm, goalSec, onChange}) {
  const [mode, setMode] = useState("time"); // "time" | "pace"
  const band = paceBand(distanceKm);

  // Normalise whenever the band exists: fill a suggestion if unset, otherwise
  // clamp into the distance-appropriate range. Done in an effect so we never
  // call the parent's setState during render.
  const suggested = suggestedGoalSec(distanceKm);
  const normalised = band ? (goalSec ? clampGoalSec(goalSec, distanceKm) : suggested) : goalSec;
  useEffect(() => {
    if (band && normalised !== goalSec) onChange(normalised);
  }, [band, normalised, goalSec, onChange]);

  if (!band) {
    return (
      <div>
        <label className="text-xs text-slate-400 block mb-1.5">Goal time</label>
        <div className="bg-slate-800/60 border border-dashed border-slate-700 rounded-xl p-3 text-xs text-slate-500">
          Enter a race distance first to set your goal.
        </div>
      </div>
    );
  }

  const dist  = parseFloat(distanceKm);
  const eff   = normalised;
  const pace  = Math.round(eff / dist);
  const tMin  = Math.round(band.fast * dist);
  const tMax  = Math.round(band.slow * dist);

  const tabCls = on =>
    "flex-1 py-1 rounded-lg text-xs font-semibold transition-colors " +
    (on ? "bg-orange-500/20 text-orange-300" : "text-slate-500 hover:text-slate-300");

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <label className="text-xs text-slate-400">
          {"Goal: "}
          <span className="text-white font-semibold">{fmt.dur(eff)}</span>
          <span className="text-slate-500">{"  ·  " + fmt.pace(pace) + "/km"}</span>
        </label>
        <div className="flex bg-slate-800 rounded-lg p-0.5 shrink-0">
          <button type="button" onClick={() => setMode("time")} className={tabCls(mode === "time")}>Time</button>
          <button type="button" onClick={() => setMode("pace")} className={tabCls(mode === "pace")}>Pace</button>
        </div>
      </div>

      {mode === "time" ? (
        <>
          <input type="range" min={tMin} max={tMax} step={10} value={eff}
            onChange={e => onChange(parseInt(e.target.value))}
            className="w-full accent-orange-500"/>
          <div className="flex justify-between text-xs text-slate-600 mt-1">
            <span>{fmt.dur(tMin)}</span><span>{fmt.dur(tMax)}</span>
          </div>
        </>
      ) : (
        <>
          <input type="range" min={band.fast} max={band.slow} step={5} value={pace}
            onChange={e => onChange(Math.round(parseInt(e.target.value) * dist))}
            className="w-full accent-orange-500"/>
          <div className="flex justify-between text-xs text-slate-600 mt-1">
            <span>{fmt.pace(band.fast) + "/km"}</span><span>{fmt.pace(band.slow) + "/km"}</span>
          </div>
        </>
      )}
    </div>
  );
}
