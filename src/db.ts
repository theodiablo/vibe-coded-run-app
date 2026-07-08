import { supabase } from "./supabase";

// Cloud-backed key/value store over the per-user `app_state` row.
//
// The whole running-coach state lives in a single jsonb blob
// (app_state.data) keyed by user_id. We mirror that blob in an in-memory
// cache so the synchronous-style db.get/db.set the app already uses keep
// working; writes are debounced into a single upsert.

let userId: string | null = null;
let cache: Record<string, unknown> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Load the user's app_state blob into the cache. Call once after sign-in,
// before rendering the app.
export async function initStore(uid: string) {
  // Flush any write still sitting in the debounce buffer before we replace the
  // cache, otherwise a reload would silently discard unsaved changes.
  await flushNow();
  userId = uid;
  // Never let a failed/aborted first load reject out of initStore: App.jsx
  // gates rendering on this resolving (storeReady), so a thrown error here
  // would strand the user on the splash spinner. Fall back to an empty cache
  // and let the app load; the next successful read/write reconciles it.
  try {
    const { data, error } = await supabase
      .from("app_state")
      .select("data")
      .eq("user_id", uid)
      .maybeSingle();
    if (error) {
      console.error("app_state load failed", error);
      cache = {};
    } else {
      cache = data && data.data ? data.data : {};
    }
  } catch (err) {
    console.error("app_state load threw", err);
    cache = {};
  }
}

// The signed-in user's id, for direct-table access modules (e.g. src/routes.ts)
// that write rows outside the app_state blob and need to satisfy RLS
// (with check auth.uid() = user_id). Null when signed out.
export function currentUserId() {
  return userId;
}

export function clearStore() {
  userId = null;
  cache = {};
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
}

async function flush() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (!userId) return;
  const { error } = await supabase.from("app_state").upsert({
    user_id: userId,
    data: cache,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error("app_state save failed", error);
}

// Flush immediately if a debounced write is pending. Safe to call when nothing
// is pending (no-op).
export async function flushNow() {
  if (saveTimer) await flush();
}

// Persist pending writes when the page is being hidden or unloaded, so a
// refresh within the debounce window can't drop the last change. visibilitychange
// is the reliable signal on mobile/desktop; pagehide covers the rest.
if (typeof window !== "undefined") {
  const persistOnExit = () => {
    if (saveTimer) flush();
  };
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistOnExit();
  });
  window.addEventListener("pagehide", persistOnExit);
}

export const db = {
  async get<T = unknown>(k: string): Promise<T | null> {
    return k in cache ? cache[k] as T : null;
  },
  async set(k: string, v: unknown) {
    cache[k] = v;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 600);
  },
};
