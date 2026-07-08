// @ts-nocheck
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RunningCoach from "./RunningCoach";

describe("RunningCoach (smoke)", () => {
  it("mounts and reaches first-run onboarding without crashing", async () => {
    render(<RunningCoach />);
    // With an empty store the app finishes loading and opens onboarding on the
    // first (Welcome / name) step.
    expect(await screen.findByText(/Welcome to Running Coach/i)).toBeInTheDocument();
  });
});
