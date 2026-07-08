import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";
import { isNative } from "./native";

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

/**
 * @typedef {RequestInit & {
 *   timeoutMs?: number | null
 * }} TimeoutRequestInit
 *
 * `timeoutMs` is intentionally a wrapper option, not part of the native fetch
 * API. Pass `null` to opt out when another cancellation mechanism owns the
 * request. If a caller supplies a native `signal` and no `timeoutMs`, we also
 * opt out of the default timeout so the caller's signal is not accidentally
 * shortened by this wrapper.
 */

/**
 * @param {RequestInfo | URL} input
 * @param {TimeoutRequestInit} init
 */
function fetchWithTimeout(input, init = {}) {
  const { timeoutMs: configuredTimeoutMs, signal: upstreamSignal, ...fetchInit } = init;
  const timeoutMs = configuredTimeoutMs ?? (upstreamSignal ? null : REQUEST_TIMEOUT_MS);

  if (timeoutMs == null) return fetch(input, { ...fetchInit, signal: upstreamSignal });

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs
  );
  let removeUpstreamAbort = () => {};
  if (upstreamSignal) {
    const abortFromUpstream = () => controller.abort(upstreamSignal.reason);
    if (upstreamSignal.aborted) abortFromUpstream();
    else {
      upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
      removeUpstreamAbort = () => upstreamSignal.removeEventListener("abort", abortFromUpstream);
    }
  }
  return fetch(input, { ...fetchInit, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    removeUpstreamAbort();
  });
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
  global: { fetch: fetchWithTimeout },
});

// Where Supabase sends the user back after an OAuth / magic-link sign-in. In the
// browser that's the app's own origin. Inside the Capacitor shell the origin is
// http://localhost (not reachable externally), so we return a registered deep
// link instead; App.jsx listens for it via @capacitor/app and completes the PKCE
// exchange. This scheme must be added to the Supabase Auth redirect allow-list.
export const AUTH_DEEP_LINK = "solutions.camboulive.run://auth-callback";
export const authRedirectTo = () =>
  isNative ? AUTH_DEEP_LINK : `${window.location.origin}/`;
