import { describe, it, expect, vi } from "vitest";
import { flushPendingHrFor, HR_PENDING_MAX_AGE_MS, type PendingHrRun } from "./pending";

const NOW = +new Date("2026-07-10T12:00:00Z");
const win = { start: NOW - 3_600_000, end: NOW - 60_000 };

const run = (over: Partial<PendingHrRun> = {}): PendingHrRun => ({
  id: "r1",
  hr: null,
  hrMax: null,
  ...over,
});

const flush = (runs: PendingHrRun[], over: Partial<Parameters<typeof flushPendingHrFor>[2]> = {}) => {
  const patches: [string, object][] = [];
  const fetchRange = over.fetchRange || vi.fn(async () => ({ hrAvg: 150, hrMax: 172 }));
  return flushPendingHrFor(runs, (id, fields) => patches.push([id, fields]), {
    field: "hrPendingHk",
    sourceId: "healthkit",
    canRead: () => true,
    now: NOW,
    ...over,
    fetchRange,
  }).then(() => ({ patches, fetchRange }));
};

describe("flushPendingHrFor", () => {
  it("resolves a pending marker in its own field", async () => {
    const { patches } = await flush([run({ hrPendingHk: { ...win, source: "healthkit" } })]);
    expect(patches).toEqual([["r1", { hr: 150, hrMax: 172 }]]);
  });

  it("never touches the OTHER platform's field — hrPending markers are invisible to the HealthKit flusher (and vice versa)", async () => {
    const { patches, fetchRange } = await flush([run({ hrPending: { ...win, source: "healthconnect" } })]);
    expect(patches).toEqual([]);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it("hrPending field keeps the shipped-client semantics: wrong-source markers are cleared", async () => {
    // Matches what already-released Android builds do to hrPending — which is
    // exactly why HealthKit markers live in hrPendingHk instead.
    const { patches, fetchRange } = await flush(
      [run({ hrPending: { ...win, source: "mystery" } })],
      { field: "hrPending", sourceId: "healthconnect" },
    );
    expect(patches).toEqual([["r1", {}]]);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it("treats a source-less hrPending marker as healthconnect (legacy stamps predate the source field)", async () => {
    const { patches } = await flush(
      [run({ hrPending: { ...win } as never })],
      { field: "hrPending", sourceId: "healthconnect" },
    );
    expect(patches).toEqual([["r1", { hr: 150, hrMax: 172 }]]);
  });

  it("clears manually-filled, corrupt, and stale markers without touching the bridge", async () => {
    const { patches, fetchRange } = await flush([
      run({ id: "manual", hr: 140, hrPendingHk: { ...win, source: "healthkit" } }),
      run({ id: "corrupt", hrPendingHk: { start: "x", end: "y", source: "healthkit" } }),
      run({ id: "stale", hrPendingHk: { start: win.start - HR_PENDING_MAX_AGE_MS, end: win.end - HR_PENDING_MAX_AGE_MS - 1, source: "healthkit" } }),
    ]);
    expect(patches).toEqual([["manual", {}], ["corrupt", {}], ["stale", {}]]);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it("does not touch the bridge when canRead is false, leaving markers pending", async () => {
    const { patches, fetchRange } = await flush(
      [run({ hrPendingHk: { ...win, source: "healthkit" } })],
      { canRead: () => false },
    );
    expect(patches).toEqual([]);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it("keeps the marker when the store has no data yet (fetch returns null)", async () => {
    const { patches } = await flush(
      [run({ hrPendingHk: { ...win, source: "healthkit" } })],
      { fetchRange: async () => null },
    );
    expect(patches).toEqual([]);
  });
});
