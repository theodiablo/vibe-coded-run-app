import type { HrPending, Run } from "../types";

export const HR_PENDING_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export type PendingHrRun = Pick<Run, "id" | "hr" | "hrMax" | "hrPending"> & Record<string, unknown>;
export type PatchHr = (id: string, fields: Partial<Pick<Run, "hr" | "hrMax">>) => void;

type FlushArgs = {
  // Which hrPending.source this flusher owns. A marker stamped by the OTHER
  // platform's health store is left pending (never cleared): hrPending syncs in
  // the blob, so clearing it here would also clear it on the device that can
  // actually resolve it. Only structurally broken, stale, or manually-filled
  // markers are cleared regardless of source — that cleanup is safe anywhere.
  sourceId: string;
  // Device-local gate evaluated before the native bridge is touched (auth
  // marker + platform + preference). Sync preferences alone are never enough.
  canRead: () => Promise<boolean> | boolean;
  fetchRange: (startMs: number, endMs: number) => Promise<{ hrAvg?: number | null; hrMax?: number | null } | null>;
  now?: number;
};

function windowOf(hrPending: HrPending | null | undefined) {
  const start = Number(hrPending?.start);
  const end = Number(hrPending?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end };
}

// Deferred post-run HR relink shared by Health Connect (Android) and HealthKit
// (iOS), mirroring routes.ts/flushPendingRoutes: on app load / foreground, retry
// the health store for fresh runs stamped with `hrPending:{start,end,source}`.
// Invalid, manually-filled, or stale markers are cleared first without touching
// the native bridge, so a bad synced blob cannot crash the app forever after
// sign-in. patch(id, {}) with no HR fields lets the caller drop hrPending
// without touching hr/hrMax — a run whose HR was filled some other way (manual
// edit) since it was stamped is never overwritten.
export async function flushPendingHrFor(
  runs: PendingHrRun[],
  patch: PatchHr,
  { sourceId, canRead, fetchRange, now = Date.now() }: FlushArgs,
) {
  const pending = (runs || []).filter(r => r.hrPending);
  if (!pending.length) return;
  const mine: { run: PendingHrRun & { id: string }; win: { start: number; end: number } }[] = [];
  for (const r of pending) {
    if (!r.id) continue;
    const win = windowOf(r.hrPending);
    // Cross-source cleanup is limited to markers that can never resolve anywhere.
    if (r.hr != null || !win || now - win.end > HR_PENDING_MAX_AGE_MS) { patch(r.id, {}); continue; }
    if ((r.hrPending?.source || "healthconnect") !== sourceId) continue; // the other store's marker — leave it
    mine.push({ run: r as PendingHrRun & { id: string }, win });
  }
  if (!mine.length) return;
  if (!(await canRead())) return; // store unavailable/unpermitted here — leave for next load
  for (const { run, win } of mine) {
    const s = await fetchRange(win.start, win.end);
    if (s && s.hrAvg) patch(run.id, { hr: s.hrAvg, hrMax: s.hrMax ?? null });
  }
}
