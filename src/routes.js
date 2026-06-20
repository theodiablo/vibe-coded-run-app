import { supabase } from "./supabase";
import { currentUserId } from "./db";

// GPS route traces live in their own `run_routes` table, NOT the app_state blob:
// a polyline is heavy and the blob is re-upserted whole on every change, so
// keeping traces separate keeps the blob small. A run in rc_runs holds only a
// summary + `routeId` reference; the trace is fetched lazily for replay.

// Insert a trace, returning its new id.
export async function saveRoute({ points, stats }) {
  const user_id = currentUserId();
  if (!user_id) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("run_routes")
    .insert({ user_id, points, stats: stats || {} })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

// Lazy-fetch a trace for replay. Returns {points, stats} or null.
export async function getRoute(id) {
  const { data, error } = await supabase
    .from("run_routes")
    .select("points, stats")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Best-effort delete (called when its run is deleted). Failure is logged, not
// thrown — the run removal must still succeed.
export async function deleteRoute(id) {
  if (!id) return;
  const { error } = await supabase.from("run_routes").delete().eq("id", id);
  if (error) console.error("route delete failed", error);
}

// All traces for the signed-in user — used to include routes in a backup.
export async function getAllRoutes() {
  const { data, error } = await supabase.from("run_routes").select("id, points, stats");
  if (error) { console.error("routes load failed", error); return []; }
  return data || [];
}

// Re-insert traces from a backup, preserving their ids so run→route links hold.
export async function restoreRoutes(routes) {
  const user_id = currentUserId();
  if (!user_id || !routes?.length) return;
  const rows = routes.map(r => ({ id: r.id, user_id, points: r.points, stats: r.stats || {} }));
  const { error } = await supabase.from("run_routes").upsert(rows);
  if (error) console.error("routes restore failed", error);
}

// ── Offline-resilient saves ────────────────────────────────────────────────
// Runs happen where signal is poor, so saveRoute on Stop can fail. We queue the
// trace in localStorage keyed by a temporary id (also stored on the run as
// `routeTmp`), then flush on next load/connectivity and patch the run with its
// real routeId. The trace is never lost.
const PENDING_KEY = "rc_pending_routes";

function loadPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; }
  catch { return []; }
}
function savePending(list) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

export function queuePendingRoute(entry) {
  const list = loadPending();
  list.push(entry);
  savePending(list);
}

// Drop a queued trace whose run was deleted before it ever synced, so it isn't
// later uploaded as an orphaned row (the privacy delete must cover pending
// traces too, not just already-synced ones).
export function removePendingRoute(tmpId) {
  if (!tmpId) return;
  const list = loadPending();
  const next = list.filter(e => e.tmpId !== tmpId);
  if (next.length !== list.length) savePending(next);
}

// Read a not-yet-uploaded trace straight from the offline queue, so a run whose
// route is still pending sync can be viewed locally before it reaches Supabase.
export function getPendingRoute(tmpId) {
  if (!tmpId) return null;
  return loadPending().find(e => e.tmpId === tmpId) || null;
}

// Retry every queued trace. Calls onSaved(tmpId, routeId) for each success so
// the caller can relink the run. Entries that still fail stay queued.
export async function flushPendingRoutes(onSaved) {
  const list = loadPending();
  if (!list.length) return;
  const remaining = [];
  for (const e of list) {
    try {
      const id = await saveRoute({ points: e.points, stats: e.stats });
      onSaved?.(e.tmpId, id);
    } catch {
      remaining.push(e);
    }
  }
  savePending(remaining);
}
