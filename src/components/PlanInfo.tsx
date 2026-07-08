import { InfoButton, InfoSection } from "./InfoButton";

// "ⓘ info" affordance + panel explaining how the training plan is built from the
// goal. Mirrors the actual logic in utils/plan.js so the explanation stays honest.
export function PlanInfo() {
  return (
    <InfoButton title="How your plan is built" label="How is this built?">
      <p className="text-slate-300 text-sm">
        Your plan is generated from three inputs — your <span className="text-white font-medium">race
        date</span>, your <span className="text-white font-medium">goal time / distance</span>, and the
        <span className="text-white font-medium"> days you can train</span>. Everything below is derived
        from those; nothing is hand-picked.
      </p>

      <InfoSection title="1 · From goal to target pace">
        <p>
          Your goal time ÷ distance gives the pace you need on race day. If the course climbs, each metre
          of ascent is counted as ~8 extra flat metres, so a hilly goal demands the fitness of a faster
          flat runner. That <span className="text-orange-300">flat-equivalent target pace</span> anchors
          every session.
        </p>
        <p>From the target pace we derive the training paces:</p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li><span className="text-emerald-400 font-medium">Easy</span> ≈ target × 1.25 — conversational, builds the aerobic engine</li>
          <li><span className="text-yellow-400 font-medium">Tempo</span> ≈ target × 1.05 — comfortably hard, at threshold</li>
          <li><span className="text-orange-400 font-medium">Intervals</span> ≈ target pace — race effort in short reps</li>
        </ul>
      </InfoSection>

      <InfoSection title="2 · Weeks and phases" accent="text-sky-400">
        <p>
          The calendar between next Monday and your race is split into 4–24 weeks, grouped into four
          phases that shift the emphasis over time:
        </p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li><span className="text-sky-400 font-medium">Base</span> (first ~4 weeks) — easy volume only, laying foundation</li>
          <li><span className="text-yellow-400 font-medium">Build</span> (middle block) — tempo and interval sessions alternate week to week</li>
          <li><span className="text-red-400 font-medium">Peak</span> (final weeks before taper) — highest volume and sharpest workouts</li>
          <li><span className="text-emerald-400 font-medium">Taper</span> (last 3 weeks) — volume drops to ~85 / 65 / 45% so you arrive fresh</li>
        </ul>
      </InfoSection>

      <InfoSection title="3 · Sizing each session" accent="text-violet-400">
        <p>
          Your longest available day becomes the <span className="text-sky-400">long run</span>; its
          distance grows week to week and is capped by the minutes you said you have (time ÷ easy pace).
          Your other days become the <span className="text-yellow-400">quality</span> sessions — easy in
          base/taper, tempo or intervals in build. Every distance is clamped so a session never exceeds
          the time you committed to.
        </p>
      </InfoSection>

      <p className="text-slate-500 text-xs">
        Changing the goal, date, elevation, or training days and regenerating rebuilds the whole schedule
        from scratch.
      </p>
    </InfoButton>
  );
}
