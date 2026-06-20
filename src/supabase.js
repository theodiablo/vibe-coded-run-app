import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// supabase-js issues every request (auth token exchange, token refresh,
// PostgREST queries) through the browser `fetch` with NO client-side timeout
// — see @supabase/auth-js `_handleRequest`, which simply `await`s the fetch.
// A single stalled connection therefore hangs forever, and because the auth
// client runs the PKCE code-exchange inside a one-shot `initialize()` promise
// that getSession(), onAuthStateChange() AND every authenticated PostgREST
// query all await, one hung request strands the whole app on the splash
// spinner after an OAuth redirect. Wrapping fetch in an AbortController-backed
// timeout bounds every request: a stall aborts and surfaces as a normal
// network error that the existing error paths already handle, instead of
// hanging indefinitely.
const REQUEST_TIMEOUT_MS = 15000;

function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    REQUEST_TIMEOUT_MS
  );
  // Forward an upstream abort (e.g. a caller-supplied signal) to our controller
  // so we don't override the library's own cancellation.
  const upstream = init.signal;
  if (upstream) {
    if (upstream.aborted) controller.abort(upstream.reason);
    else upstream.addEventListener("abort", () => controller.abort(upstream.reason), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
  global: { fetch: fetchWithTimeout },
});

export const authRedirectTo = () => `${window.location.origin}/`;
