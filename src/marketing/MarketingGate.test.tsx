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
});
