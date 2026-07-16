import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { Confetti } from "./Confetti";

// Confetti is a decorative, pointer-transparent burst that renders `count`
// particles — and nothing at all under reduced motion.

function setReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("Confetti", () => {
  afterEach(() => {
    vi.useRealTimers();
    setReducedMotion(false);
  });

  it("renders `count` decorative, non-interactive particles", () => {
    const { container } = render(<Confetti count={12} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("pointer-events-none");
    expect(root).toHaveAttribute("aria-hidden");
    expect(root.querySelectorAll("span")).toHaveLength(12);
  });

  it("renders nothing under reduced motion but still fires onDone", () => {
    vi.useFakeTimers();
    setReducedMotion(true);
    const onDone = vi.fn();
    const { container } = render(<Confetti count={12} onDone={onDone} />);
    expect(container.firstElementChild).toBe(null);
    vi.runAllTimers();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
