import { beforeEach, describe, it, expect, vi } from "vitest";
import { HR_HEALTH_CONNECT_AUTH_KEY } from "../constants";
import { flushPendingHr, hasHealthConnectAuthorization, HR_PENDING_MAX_AGE_MS } from "./healthconnect";

beforeEach(() => {
  localStorage.clear();
});

describe("flushPendingHr", () => {
  it("clears manual, invalid, and stale pending markers without querying Health Connect", async () => {
    const now = 10 * 24 * 60 * 60 * 1000;
    const patch = vi.fn();

    await flushPendingHr([
      { id: "manual", hr: 140, hrPending: { start: String(now - 1000), end: String(now - 500), source: "healthconnect" } },
      { id: "invalid", hrPending: { start: String(now), end: String(now - 1), source: "healthconnect" } },
      { id: "stale", hrPending: { start: String(now - HR_PENDING_MAX_AGE_MS - 2000), end: String(now - HR_PENDING_MAX_AGE_MS - 1000), source: "healthconnect" } },
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
      { id: "fresh", hrPending: { start: String(now - 2000), end: String(now - 1000), source: "healthconnect" } },
    ], patch, { enabled: false, now });

    expect(patch).not.toHaveBeenCalled();
  });

  it("leaves fresh pending markers untouched when native reads are deferred", async () => {
    const now = Date.now();
    const patch = vi.fn();

    await flushPendingHr([
      { id: "fresh", hrPending: { start: String(now - 2000), end: String(now - 1000), source: "healthconnect" } },
    ], patch, { enabled: true, allowNativeRead: false, now });

    expect(patch).not.toHaveBeenCalled();
  });

  it("does not touch fresh pending markers without local Health Connect authorization", async () => {
    const now = Date.now();
    const patch = vi.fn();

    await flushPendingHr([
      { id: "fresh", hrPending: { start: String(now - 2000), end: String(now - 1000), source: "healthconnect" } },
    ], patch, { enabled: true, allowNativeRead: true, now });

    expect(hasHealthConnectAuthorization()).toBe(false);
    expect(patch).not.toHaveBeenCalled();
  });

  it("recognizes the local Health Connect authorization marker", () => {
    localStorage.setItem(HR_HEALTH_CONNECT_AUTH_KEY, "1");

    expect(hasHealthConnectAuthorization()).toBe(true);
  });
});
