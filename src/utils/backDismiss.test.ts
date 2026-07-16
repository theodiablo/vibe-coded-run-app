import { describe, it, expect, vi } from "vitest";
import { pushDismiss, dismissTop } from "./backDismiss";

// The LIFO dismiss registry behind Escape / Android-back handling.

describe("backDismiss", () => {
  it("returns false when nothing is registered", () => {
    expect(dismissTop()).toBe(false);
  });

  it("invokes the topmost (last-registered) handler", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = pushDismiss(a);
    const offB = pushDismiss(b);
    expect(dismissTop()).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    offA();
    offB();
  });

  it("falls back to the next handler once the top unregisters", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = pushDismiss(a);
    const offB = pushDismiss(b);
    offB(); // top overlay closed/unmounted
    expect(dismissTop()).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    offA();
  });

  it("does not pop the handler, so a refused dismiss stays on top", () => {
    // A guarded handler that declines to close leaves itself registered; the
    // next back press hits it again (never the layer beneath).
    const guarded = vi.fn();
    const beneath = vi.fn();
    const offBeneath = pushDismiss(beneath);
    const offGuarded = pushDismiss(guarded);
    dismissTop();
    dismissTop();
    expect(guarded).toHaveBeenCalledTimes(2);
    expect(beneath).not.toHaveBeenCalled();
    offGuarded();
    offBeneath();
  });

  it("unregister only removes its own entry", () => {
    const a = vi.fn();
    const offA = pushDismiss(a);
    offA();
    expect(dismissTop()).toBe(false);
    offA(); // idempotent — no throw
  });
});
