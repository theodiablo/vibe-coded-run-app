// "How this session unfolds" — the expandable step-by-step breakdown behind a
// plan-session card tap in PlanView. Pure and parse-based: everything is
// derived from the session row itself (type, desc, km, pace), so it works for
// generated AND coach-edited sessions and never needs the plan or style.
// The km on a rep session is the whole outing (reps + warmup/recovery
// allowance), which is exactly the confusion this breakdown exists to answer.
import { fmt } from "./format";

export type SessionStep = { label: string; detail: string };

type SessionLike = { type?: string; desc?: string; km?: number | string; pace?: number | string | null };

const STRETCH: SessionStep = {
  label: "Stretch",
  detail: "5 min of gentle stretching — calves, quads, hamstrings, hips.",
};

// "5x800m", "3x3km", "6x400m" — the rep block a workout desc promises.
const parseReps = (desc: string) => {
  const m = desc.match(/(\d+)x(\d+(?:\.\d+)?)(km|m)\b/i);
  if (!m) return null;
  return { count: Number(m[1]), dist: m[3].toLowerCase() === "km" ? m[2] + " km" : m[2] + " m" };
};

// "+ 90s recovery", "+ 90s jog recovery", "+ 1km jog recovery", "+ recovery jogs".
const parseRecovery = (desc: string) => {
  const m = desc.match(/\+\s*([^.]*recover[^.,]*)/i);
  return m ? m[1].trim() : "an easy jog";
};

// "run 2 min / walk 1 min" — the Galloway ratio carried in runwalk descs.
const parseRatio = (desc: string) => {
  const m = desc.match(/run\s+(\d+)\s*min\s*\/\s*walk\s+(\d+)\s*min/i);
  return m ? { run: Number(m[1]), walk: Number(m[2]) } : null;
};

export function sessionSteps(s: SessionLike): SessionStep[] {
  const type = String(s.type || "");
  const desc = String(s.desc || "");
  const km = Number(s.km) || 0;
  const pace = Number(s.pace) || 0;
  const paceTxt = pace ? fmt.pace(pace) + "/km" : null;

  if (type === "INTERVALS") {
    const reps = parseReps(desc);
    const workout = reps
      ? reps.count + " × " + reps.dist + (paceTxt ? " at " + paceTxt : "")
        + ", with " + parseRecovery(desc) + " between reps."
      : "Repeats" + (paceTxt ? " at " + paceTxt : "") + " with easy jog recoveries between them.";
    return [
      { label: "Warm-up", detail: "10–15 min easy jogging, finishing with a few relaxed strides." },
      { label: "Workout", detail: workout },
      { label: "Cool-down", detail: "5–10 min very easy jog to bring the heart rate down." },
      STRETCH,
    ];
  }

  if (type === "TEMPO") {
    return [
      { label: "Warm-up", detail: "10–15 min easy jogging." },
      { label: "Workout", detail: (km ? "~" + km + " km" : "The main block")
        + (paceTxt ? " at " + paceTxt : "")
        + " — comfortably hard: controlled, but you couldn't hold a chat." },
      { label: "Cool-down", detail: "5–10 min very easy jog." },
      STRETCH,
    ];
  }

  if (type === "LONG") {
    const ratio = parseRatio(desc);
    const steps: SessionStep[] = [
      { label: "Start", detail: "Ease into it — the first 10 min should feel almost too slow." },
      { label: "Main", detail: ratio
        ? "Settle into run " + ratio.run + " min / walk " + ratio.walk
          + " min for the full distance, conversational throughout."
        : "Hold a relaxed, conversational effort" + (paceTxt ? " around " + paceTxt : "") + " the whole way." },
    ];
    if (km >= 15) steps.push({
      label: "Fuel",
      detail: "Drink regularly and take carbs every 30–40 min — practice your race-day fuelling.",
    });
    steps.push(STRETCH);
    return steps;
  }

  if (type === "WALK") {
    const ratio = parseRatio(desc);
    if (ratio) return [
      { label: "Warm-up", detail: "5 min of brisk walking." },
      { label: "Main", detail: "Alternate run " + ratio.run + " min / walk " + ratio.walk
        + " min — keep every run segment conversational." },
      { label: "Cool-down", detail: "5 min of easy walking." },
      STRETCH,
    ];
    return [
      { label: "Activity", detail: "Brisk walk or low-impact cross-training — easy effort, no pounding." },
      STRETCH,
    ];
  }

  if (type === "RACE") {
    return [
      { label: "Before", detail: "Arrive early. 10 min easy jog and a few strides, then keep warm." },
      { label: "Race", detail: "Start controlled" + (paceTxt ? " — target " + paceTxt : "")
        + "; the first kilometres should feel easy." },
      { label: "After", detail: "Keep walking a few minutes, refuel, and celebrate." },
    ];
  }

  if (type === "OTHER") {
    return [
      { label: "Activity", detail: "Optional cross-training — bike, swim or elliptical at an easy effort. Skip it if you're tired." },
      STRETCH,
    ];
  }

  // EASY and anything unrecognised.
  return [
    { label: "Run", detail: "Fully conversational" + (paceTxt ? " — around " + paceTxt : "")
      + "; walking breaks are fine." },
    { label: "Finish", detail: "A few minutes of walking, then light stretching." },
  ];
}
