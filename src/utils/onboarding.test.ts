import { describe, it, expect } from "vitest";
import { onboardingSteps } from "./onboarding";

describe("onboardingSteps", () => {
  it("returns the race branch for the race intent", () => {
    expect(onboardingSteps("race")).toEqual(
      ["welcome", "intent", "race", "raceGoal", "hr", "health", "summary"]);
  });
  it("returns the lighter training branch for the fitness intent", () => {
    expect(onboardingSteps("fitness")).toEqual(
      ["welcome", "intent", "training", "hr", "health", "summary"]);
  });
  it("defaults to the race branch when intent is unset", () => {
    expect(onboardingSteps(null)).toEqual(onboardingSteps("race"));
    expect(onboardingSteps(undefined)).toEqual(onboardingSteps("race"));
  });
  it("shares an identical [welcome, intent] prefix across branches", () => {
    const race = onboardingSteps("race");
    const fit = onboardingSteps("fitness");
    expect(race.slice(0, 2)).toEqual(["welcome", "intent"]);
    expect(fit.slice(0, 2)).toEqual(race.slice(0, 2));
  });
  it("ends every branch with the health gate before the summary", () => {
    for (const intent of ["race", "fitness", null]) {
      const seq = onboardingSteps(intent);
      expect(seq[seq.length - 1]).toBe("summary");
      expect(seq[seq.length - 2]).toBe("health");
    }
  });
});
