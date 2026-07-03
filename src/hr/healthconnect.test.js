import { describe, it, expect, vi } from "vitest";
import { flushPendingHr, HR_PENDING_MAX_AGE_MS } from "./healthconnect";

describe("flushPendingHr", () => {
  it("clears manual, invalid, and stale pending markers without querying Health Connect", async () => {
    const now = 10 * 24 * 60 * 60 * 1000;
    const patch = vi.fn();

    await flushPendingHr([
      { id: "manual", hr: 140, hrPending: { start: now - 1000, end: now - 500, source: "healthconnect" } },
      { id: "invalid", hrPending: { start: now, end: now - 1, source: "healthconnect" } },
      { id: "stale", hrPending: { start: now - HR_PENDING_MAX_AGE_MS - 2000, end: now - HR_PENDING_MAX_AGE_MS - 1000, source: "healthconnect" } },
    ], patch, { enabled: false, now });

    expect(patch).toHaveBeenCalledTimes(3);
    expect(patch).toHaveBeenCalledWith("manual", {});
    expect(patch).toHaveBeenCalledWith("invalid", {});
    expect(patch).toHaveBeenCalledWith("stale", {});
  });

  it("leaves fresh pending markers untouched when sync is disabled", async () => {
    const now = Date.now();
    const patch = vi.fn();

    await flushPendingHr([
      { id: "fresh", hrPending: { start: now - 2000, end: now - 1000, source: "healthconnect" } },
    ], patch, { enabled: false, now });

    expect(patch).not.toHaveBeenCalled();
  });

  it("leaves fresh pending markers untouched when native reads are deferred", async () => {
    const now = Date.now();
    const patch = vi.fn();

    await flushPendingHr([
      { id: "fresh", hrPending: { start: now - 2000, end: now - 1000, source: "healthconnect" } },
    ], patch, { enabled: true, allowNativeRead: false, now });

    expect(patch).not.toHaveBeenCalled();
  });
});
