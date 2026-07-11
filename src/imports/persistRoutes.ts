import { simplify } from "../utils/geo";
import { saveRoute, queuePendingRoute } from "../routes";
import type { ImportedRun } from "./types";
import type { Run } from "../types";

// Persist an imported run's transient route `points` (GPX/TCX today; any
// future scan provider that returns traces) and swap them for a route
// reference, with the same save-or-queue offline fallback as
// LiveRunTracker.handleSave. Runs without points pass through untouched.
// This is THE step the ImportProvider contract assigns to the caller: providers
// return points, the save path persists them, and `points` never reaches
// addRuns (route traces don't belong in the synced blob).
export async function persistImportedRoute(r: ImportedRun): Promise<Partial<Run>> {
  const { points, ...run } = r;
  if (!points?.length) return run;
  const pts = simplify(points, 5);
  const stats = {
    km: run.km || 0,
    durationSec: run.durationSec || 0,
    elevation: run.elevation || 0,
    avgPace: run.km ? Math.round((run.durationSec || 0) / run.km) : 0,
  };
  try {
    return { ...run, routeId: await saveRoute({ points: pts, stats }) };
  } catch {
    const routeTmp = "rt" + Date.now();
    queuePendingRoute({ tmpId: routeTmp, points: pts, stats });
    return { ...run, routeTmp, routePending: true };
  }
}

export function persistImportedRoutes(runs: ImportedRun[]): Promise<Partial<Run>[]> {
  return Promise.all(runs.map(persistImportedRoute));
}
