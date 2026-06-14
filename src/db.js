import { supabase } from "./supabase";

// Cloud-backed key/value store over the per-user `app_state` row.
//
// The whole running-coach state lives in a single jsonb blob
// (app_state.data) keyed by user_id. We mirror that blob in an in-memory
// cache so the synchronous-style db.get/db.set the app already uses keep
// working; writes are debounced into a single upsert.

let userId = null;
let cache = {};
let saveTimer = null;

// Load the user's app_state blob into the cache. Call once after sign-in,
// before rendering the app.
export async function initStore(uid) {
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

export function clearStore() {
  userId = null;
  cache = {};
  clearTimeout(saveTimer);
  saveTimer = null;
}

async function flush() {
  clearTimeout(saveTimer);
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
  async get(k) {
    return k in cache ? cache[k] : null;
  },
  async set(k, v) {
    cache[k] = v;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 600);
  },
};
