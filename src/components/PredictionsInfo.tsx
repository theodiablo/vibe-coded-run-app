import { InfoButton, InfoSection } from "./InfoButton";

// "ⓘ info" affordance + panel explaining how race predictions are computed.
// Mirrors the maths in utils/predictions.js.
export function PredictionsInfo() {
  return (
    <InfoButton title="How predictions work" label="How does this work?">
      <p className="text-slate-300 text-sm">
        Predictions project your finish time at each distance from the runs you've actually logged. Two
        independent methods are shown so you can sanity-check one against the other.
      </p>

      <InfoSection title="Riegel's formula — the engine">
        <p>
          Both estimates extrapolate a known time to a new distance with Peter Riegel's endurance model:
        </p>
        <p className="font-mono text-slate-300 text-[11px] bg-slate-900/60 rounded-lg p-2">
          t₂ = t₁ × (d₂ / d₁)<sup>1.06</sup>
        </p>
        <p>
          The <span className="text-slate-300">1.06</span> exponent is the standard fatigue factor: going
          further costs slightly more than linear time, because you can't hold a 5 km pace for 20 km.
        </p>
      </InfoSection>

      <InfoSection title="Best-effort estimate" accent="text-orange-400">
        <p>
          Picks your single <span className="text-orange-300">strongest run</span> (≥ 3 km with a time)
          and projects it to every distance. It isn't simply your fastest pace — a quick 1 km blip
          shouldn't outrank a strong 12 km — so each run is first normalised to its Riegel-equivalent
          10 km time, and the best one wins.
        </p>
      </InfoSection>

      <InfoSection title="HR-modelled estimate" accent="text-sky-400">
        <p>
          Fits a line through <span className="text-sky-300">pace vs. heart rate</span> across all your
          runs that recorded HR, then reads off the pace you could hold at threshold effort (~88–90% of
          max HR, roughly a one-hour race) and projects that with Riegel.
        </p>
        <p>
          This rewards efficiency: a fast pace held at a low HR pulls the estimate quicker, so your easy
          runs count too — not just your single best day. It only appears once the data supports it
          (≥ 8 HR runs, a real spread of efforts, and a sensible fit).
        </p>
      </InfoSection>

      <InfoSection title="Elevation adjustment" accent="text-emerald-400">
        <p>
          Hills make a run slower than its flat twin, so each metre climbed is credited as ~8 extra flat
          metres before the maths runs. This stops hilly runs from looking unfit. Listed times are for a
          flat course; the <span className="text-orange-300">race-day row</span> adds back your course's
          climb once you set it in the Plan.
        </p>
      </InfoSection>

      <p className="text-slate-500 text-xs">
        These are projections from past efforts, not promises — treat them as a fitness gauge that sharpens
        as you log more runs.
      </p>
    </InfoButton>
  );
}
