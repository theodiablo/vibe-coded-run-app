import { simplify } from "../utils/geo";
import { saveRoute, queuePendingRoute } from "../routes";
import type { ImportedRun } from "./types";
import type { Run } from "../types";

// Persist an imported run's transient route `points` (GPX/TCX; HealthKit route)
// and/or raw HR series (health-store imports), swapping them for a run_routes
// reference, with the same save-or-queue offline fallback as
// LiveRunTracker.handleSave. Runs with neither pass through untouched. This is
// THE step the ImportProvider contract assigns to the caller: providers return
// points/hrSamples, the save path persists them into the (blob-external)
// run_routes row, and neither reaches addRuns.
//
// A GPS trace rides `routeId` (History shows a map button). An HR-only sidecar
// (HR series, no GPS — the common Garmin/Samsung-on-Health-Connect case) rides
// the separate `hrRouteId`, so the run powers the detail HR chart/time-in-zone
// card without History offering a blank map. The raw HR stream sits in the same
// `stats.hrSamples` sidecar a BLE-strap run uses.
export async function persistImportedRoute(r: ImportedRun): Promise<Partial<Run>> {
  const { points, hrSamples, ...run } = r;
  const hasRoute = !!points?.length;
  const hasHr = !!hrSamples?.length;
  if (!hasRoute && !hasHr) return run;
  const pts = hasRoute ? simplify(points!, 5) : [];
  const stats = {
    km: run.km || 0,
    durationSec: run.durationSec || 0,
    elevation: run.elevation || 0,
    avgPace: run.km ? Math.round((run.durationSec || 0) / run.km) : 0,
    ...(hasHr ? { hrSamples } : {}),
  };
  try {
    const id = await saveRoute({ points: pts, stats });
    return hasRoute ? { ...run, routeId: id } : { ...run, hrRouteId: id };
  } catch {
    // Only a GPS trace is user-authored data worth the offline queue. An HR-only
    // sidecar is enrichment — the run keeps its avg/max HR aggregates — so on a
    // failed save we drop the raw series rather than grow a second pending queue.
    if (!hasRoute) return run;
    const routeTmp = "rt" + Date.now();
    queuePendingRoute({ tmpId: routeTmp, points: pts, stats });
    return { ...run, routeTmp, routePending: true };
  }
}

export function persistImportedRoutes(runs: ImportedRun[]): Promise<Partial<Run>[]> {
  return Promise.all(runs.map(persistImportedRoute));
}
