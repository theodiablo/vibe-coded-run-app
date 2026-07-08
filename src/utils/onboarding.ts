// Onboarding flow shape. Kept pure (no React) so the branch sequencing — the
// riskiest part of the wizard — is unit-testable and lives outside the component.
//
// The wizard branches on the user's `intent`: a race-targeting user gets a race
// picker + goal step, a "just getting started" user gets a lighter training-only
// step. Both branches share an identical [welcome, intent] prefix so a refresh
// before intent is chosen resolves the same regardless of branch, and both end
// with the mandatory health gate followed by an (in-memory only) summary.
import type { Intent } from "../types";

export type OnboardingStep = "welcome" | "intent" | "race" | "raceGoal" | "training" | "hr" | "health" | "summary";

export function onboardingSteps(intent: Intent | string | undefined): OnboardingStep[] {
  const tail: OnboardingStep[] = ["hr", "health", "summary"];
  if (intent === "fitness") return ["welcome", "intent", "training", ...tail];
  // Default (intent unset or "race") — the race branch.
  return ["welcome", "intent", "race", "raceGoal", ...tail];
}
