import { useEffect, useState } from "react";
import { getRoute, getPendingRoute } from "../routes";
import type { TrackPoint } from "../components/RouteMap";
import type { Run } from "../types";

// A loaded GPS trace: the simplified points plus the freeform stats sidecar
// (which now also carries the raw HR stream as `stats.hrSamples` for BLE runs).
export type RouteData = { points: (TrackPoint | null)[]; stats?: Record<string, unknown> } | null | undefined;

// Lazily load a run's saved GPS trace (kept out of the synced runs blob). A synced
// run fetches from Supabase by `routeId`; one still pending upload reads straight
// from the offline queue so it's viewable before it syncs. `undefined` = loading,
// `null` = unavailable. Shared by History's map loader and RunDetailModal so the
// two never drift.
export function useRouteTrace(run: Run): { route: RouteData } {
  const [route, setRoute] = useState<RouteData>(() => run.routeId ? undefined : getPendingRoute(run.routeTmp) as RouteData);
  useEffect(() => {
    if (!run.routeId) return; // pending route already pulled from localStorage
    let on = true;
    getRoute(run.routeId).then(r => on && setRoute(r as RouteData)).catch(() => on && setRoute(null));
    return () => { on = false; };
  }, [run.routeId]);
  return { route };
}
