import type { Run } from "../types";
import type { ImportedRun } from "./types";

// THE one duplicate-run rule set. Everything dedupes on the mapped run shape —
// watch scans (newWatchSessions), the registry's cross-provider pass, and file
// imports — so the rules can't drift between implementations:
//  1. external-id match — hcId/extId equal, each in its own id-space;
//  2. time-window overlap when both sides know their start instant;
//  3. fuzzy fallback: same date and distance within 10% (opt-out).
//
// The fuzzy rule is a trade-off: it exists so a watch scan doesn't re-offer a
// run the user already logged BY HAND (no startedAt to overlap against) — the
// common case — at the cost of occasionally swallowing a genuinely distinct
// same-day similar-distance run. Auto-scans keep it (an offer toast is cheap to
// re-create, a double-log isn't); the file-import path turns it OFF
// ({fuzzy:false}) because a user-picked export must never silently drop rows —
// its runs carry startedAt (GPX/TCX always, CSV when the export has times), so
// the precise overlap rule still catches true re-imports.
const FUZZY_KM_TOLERANCE = 0.1;

type RunLike = Partial<Run>;

function windowOf(r: RunLike): { start: number; end: number } | null {
  if (!r.startedAt || !r.durationSec) return null;
  const start = +new Date(r.startedAt);
  if (!Number.isFinite(start)) return null;
  return { start, end: start + r.durationSec * 1000 };
}

export function isDuplicateRun(
  cand: ImportedRun,
  existing: RunLike[],
  seenIds: string[] = [],
  { fuzzy = true }: { fuzzy?: boolean } = {},
): boolean {
  if (cand.hcId && seenIds.includes(cand.hcId)) return true;
  const cw = windowOf(cand);
  const cKm = Number(cand.km) || 0;
  for (const r of existing) {
    if (cand.hcId && r.hcId === cand.hcId) return true;
    if (cand.extId && r.extId === cand.extId) return true;
    const rw = windowOf(r);
    if (cw && rw) {
      if (rw.start < cw.end && cw.start < rw.end) return true;
    } else if (fuzzy && cKm > 0 && r.date === cand.date) {
      const rKm = Number(r.km) || 0;
      if (Math.abs(rKm - cKm) <= FUZZY_KM_TOLERANCE * Math.max(rKm, cKm)) return true;
    }
  }
  return false;
}
