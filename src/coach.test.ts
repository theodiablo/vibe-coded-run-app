import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the network + side-effect seams so we can drive coach.ts's error mapping
// deterministically. The real ./supabase would build a client from env config.
const invokeMock = vi.fn();
vi.mock("./supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } } }));
vi.mock("./db", () => ({ flushNow: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./telemetry", () => ({ track: vi.fn() }));

import { coachPropose, coachUsage, CoachServerError } from "./coach";

describe("coach server-error mapping (regression: primary invoke path)", () => {
  beforeEach(() => invokeMock.mockReset());

  it("throws a CoachServerError carrying code + usage on a server-error body", async () => {
    invokeMock.mockResolvedValue({ data: { error: "rate", code: "RATE_LIMIT", usage: { used: 5, limit: 5 } }, error: null });
    // The whole absorbServerError mechanism (refresh ring, drop stale trajectory)
    // depends on the primary invoke() path preserving code/usage — not a bare Error.
    await expect(coachPropose("hi")).rejects.toBeInstanceOf(CoachServerError);
    await expect(coachPropose("hi")).rejects.toMatchObject({ code: "RATE_LIMIT", usage: { used: 5, limit: 5 } });
  });

  it("propagates TRAJECTORY_CLOSED with its code", async () => {
    invokeMock.mockResolvedValue({ data: { error: "closed", code: "TRAJECTORY_CLOSED" }, error: null });
    await expect(coachPropose("hi")).rejects.toMatchObject({ code: "TRAJECTORY_CLOSED", usage: undefined });
  });
});

describe("coachUsage (best-effort, hides ring on failure)", () => {
  beforeEach(() => invokeMock.mockReset());

  it("returns {used,limit} on success", async () => {
    invokeMock.mockResolvedValue({ data: { used: 2, limit: 5 }, error: null });
    expect(await coachUsage()).toEqual({ used: 2, limit: 5 });
  });

  it("returns null when an old function rejects the usage action", async () => {
    invokeMock.mockResolvedValue({ data: { error: "action must be propose | critique | confirm | result" }, error: null });
    expect(await coachUsage()).toBeNull();
  });

  it("returns null on a transport error", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("offline") });
    expect(await coachUsage()).toBeNull();
  });
});
