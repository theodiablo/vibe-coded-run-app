import { describe, it, expect, vi } from "vitest";
import { flushPendingHrFor, HR_PENDING_MAX_AGE_MS, type PendingHrRun } from "./pending";

const NOW = +new Date("2026-07-10T12:00:00Z");
const win = { start: NOW - 3_600_000, end: NOW - 60_000 };

const run = (over: Partial<PendingHrRun> = {}): PendingHrRun => ({
  id: "r1",
  hr: null,
  hrMax: null,
  hrPending: { ...win, source: "healthkit" },
  ...over,
});

const flush = (runs: PendingHrRun[], over: Partial<Parameters<typeof flushPendingHrFor>[2]> = {}) => {
  const patches: [string, object][] = [];
  const fetchRange = over.fetchRange || vi.fn(async () => ({ hrAvg: 150, hrMax: 172 }));
  return flushPendingHrFor(runs, (id, fields) => patches.push([id, fields]), {
    sourceId: "healthkit",
    canRead: () => true,
    now: NOW,
    ...over,
    fetchRange,
  }).then(() => ({ patches, fetchRange }));
};

describe("flushPendingHrFor", () => {
  it("resolves its own source's pending marker", async () => {
    const { patches } = await flush([run()]);
    expect(patches).toEqual([["r1", { hr: 150, hrMax: 172 }]]);
  });

  it("leaves the OTHER source's live marker alone — clearing it here would also clear it on the device that can resolve it", async () => {
    const { patches, fetchRange } = await flush([run({ hrPending: { ...win, source: "healthconnect" } })]);
    expect(patches).toEqual([]);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it("clears manually-filled, corrupt, and stale markers regardless of source", async () => {
    const { patches, fetchRange } = await flush([
      run({ id: "manual", hr: 140, hrPending: { ...win, source: "healthconnect" } }),
      run({ id: "corrupt", hrPending: { start: "x", end: "y", source: "healthconnect" } }),
      run({ id: "stale", hrPending: { start: win.start - HR_PENDING_MAX_AGE_MS, end: win.end - HR_PENDING_MAX_AGE_MS - 1, source: "healthconnect" } }),
    ]);
    expect(patches).toEqual([["manual", {}], ["corrupt", {}], ["stale", {}]]);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it("treats a source-less marker as healthconnect (legacy stamps predate the source field)", async () => {
    const { patches } = await flush([run({ hrPending: { ...win } as never })]);
    expect(patches).toEqual([]); // healthkit flusher: not mine
  });

  it("does not touch the bridge when canRead is false, leaving markers pending", async () => {
    const { patches, fetchRange } = await flush([run()], { canRead: () => false });
    expect(patches).toEqual([]);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it("keeps the marker when the store has no data yet (fetch returns null)", async () => {
    const { patches } = await flush([run()], { fetchRange: async () => null });
    expect(patches).toEqual([]);
  });
});
