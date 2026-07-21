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
// two never drift. `withStats` fetches the `stats` sidecar (incl. the raw HR
// stream) — the map-only preview leaves it false to skip that payload.
export function useRouteTrace(run: Run, opts?: { withStats?: boolean }): { route: RouteData } {
  const withStats = opts?.withStats ?? false;
  // A GPS trace lives on routeId; an HR-only sidecar (no GPS) on hrRouteId. Both
  // are run_routes rows, so either resolves the same {points, stats} shape —
  // points is simply empty for an HR-only row (RunDetailModal renders the HR
  // chart/zones; History never mounts this hook for an hrRouteId-only run).
  const traceId = run.routeId ?? run.hrRouteId;
  const [route, setRoute] = useState<RouteData>(() => traceId ? undefined : getPendingRoute(run.routeTmp) as RouteData);
  useEffect(() => {
    if (!traceId) return; // pending route already pulled from localStorage
    let on = true;
    getRoute(traceId, withStats).then(r => on && setRoute(r as RouteData)).catch(() => on && setRoute(null));
    return () => { on = false; };
  }, [traceId, withStats]);
  return { route };
}
