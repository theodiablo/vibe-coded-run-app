import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MarketingGate from "./MarketingGate";

describe("MarketingGate", () => {
  it("renders the marketing landing without a login form until asked", () => {
    render(<MarketingGate />);
    expect(screen.getByText(/Train for your race/i)).toBeInTheDocument();
    // The login form (reused LoginScreen) is not mounted until the user opts in.
    expect(screen.queryByPlaceholderText(/you@example.com/i)).toBeNull();
  });

  it("opens the login modal when the visitor chooses to log in", () => {
    render(<MarketingGate />);
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));
    expect(screen.getByPlaceholderText(/you@example.com/i)).toBeInTheDocument();
  });

  it("links to both mobile beta programs", () => {
    render(<MarketingGate />);

    expect(screen.getAllByRole("link", { name: /iOS beta|TestFlight/i })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /iOS beta|TestFlight/i })[0]).toHaveAttribute(
      "href",
      "https://testflight.apple.com/join/T73yu15A",
    );
    const androidBetaLinks = screen.getAllByRole("link", { name: /Android.*beta/i });
    expect(androidBetaLinks).toHaveLength(2);
    expect(androidBetaLinks[0]).toHaveAttribute(
      "href",
      "https://play.google.com/apps/testing/solutions.camboulive.run",
    );
  });
});
