import { createClient } from "@supabase/supabase-js";
import { dlog } from "./oauthDebug"; // TEMP diagnostics

// The publishable (anon) key is PUBLIC-safe: it grants nothing on its own.
// Row-Level Security on the `app_state` / `profiles` tables is the real
// boundary — anonymous requests are denied. NEVER put the secret key here.
// Overridable at build time via Vite env vars, with safe defaults baked in so
// the static S3/CloudFront build works without extra workflow config.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://jpnxghiyjpuqnznxyfaf.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_TfqcHK58CUJtm79HT8-BMg_dx_b3Lhs";

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
  // TEMP diagnostics: name the request by its URL path so we can see in the
  // console exactly which Supabase call starts, finishes, or times out.
  let label = "";
  try {
    const raw = typeof input === "string" ? input : input?.url ?? String(input);
    label = `${init.method || "GET"} ${new URL(raw).pathname}`;
  } catch {
    label = String(input);
  }
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  dlog("fetch START", label);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    dlog("fetch TIMEOUT — aborting", label, `after ${REQUEST_TIMEOUT_MS}ms`);
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, REQUEST_TIMEOUT_MS);
  // Forward an upstream abort (e.g. a caller-supplied signal) to our controller
  // so we don't override the library's own cancellation.
  const upstream = init.signal;
  if (upstream) {
    if (upstream.aborted) controller.abort(upstream.reason);
    else upstream.addEventListener("abort", () => controller.abort(upstream.reason), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal })
    .then((res) => {
      const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
      dlog("fetch DONE", label, "status", res.status, `${ms}ms`);
      return res;
    })
    .catch((err) => {
      const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
      dlog("fetch ERROR", label, err?.name || err, `${ms}ms`);
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  // TEMP: `debug: true` turns on supabase-js's internal auth logs
  // (#_initialize, #_acquireLock, #_recoverAndRefresh, etc.) so we can see
  // exactly where the OAuth redirect flow stalls. Remove once the bug is found.
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, debug: true },
  global: { fetch: fetchWithTimeout },
});

export const authRedirectTo = () => `${window.location.origin}/`;
