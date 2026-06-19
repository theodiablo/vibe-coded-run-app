import { useEffect, useRef } from "react";
import { fmt } from "../utils/format";
import { paceBand, suggestedGoalSec, clampGoalSec } from "../utils/goal";

// Goal-setting control shared by onboarding and the plan view. A slider sets the
// target finish time, and its range adapts to the entered distance so it only
// ever offers realistic times. Changing the distance resets the goal to a fresh
// mid-pack suggestion for that distance, so a time picked for one race length
// never lingers on another (e.g. a 5 km time left sitting on a 20 km race).
export function GoalConfigurator({distanceKm, goalSec, onChange}) {
  const band = paceBand(distanceKm);
  const suggested = suggestedGoalSec(distanceKm);

  // When the distance is unset/out-of-band we fill a suggestion, otherwise we
  // clamp an existing goal into the distance-appropriate range. The distance
  // change itself is handled in the effect below.
  const normalised = band ? (goalSec ? clampGoalSec(goalSec, distanceKm) : suggested) : goalSec;

  // Push the normalised value up to the parent (never setState during render).
  // A change in distance always re-suggests rather than carrying the old goal
  // over — otherwise a time picked for one race length lingers on another (a
  // 5 km time left sitting on a 20 km race).
  const prevDist = useRef(distanceKm);
  useEffect(() => {
    const distChanged = prevDist.current !== distanceKm;
    prevDist.current = distanceKm;
    if (!band) return;
    if (distChanged) onChange(suggested);
    else if (normalised !== goalSec) onChange(normalised);
  }, [band, distanceKm, suggested, normalised, goalSec, onChange]);

  if (!band) {
    return (
      <div>
        <label className="text-xs text-slate-400 block mb-1.5">Goal time</label>
        <div className="bg-slate-800/60 border border-dashed border-slate-700 rounded-xl p-3 text-xs text-slate-400">
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

  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1.5">
        {"Goal: "}
        <span className="text-white font-semibold">{fmt.dur(eff)}</span>
        <span className="text-slate-400">{"  ·  " + fmt.pace(pace) + "/km"}</span>
      </label>
      <input type="range" min={tMin} max={tMax} step={10} value={eff}
        onChange={e => onChange(parseInt(e.target.value))}
        className="w-full accent-orange-500"/>
      <div className="flex justify-between text-xs text-slate-400 mt-1">
        <span>{fmt.dur(tMin)}</span><span>{fmt.dur(tMax)}</span>
      </div>
    </div>
  );
}
