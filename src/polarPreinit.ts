// Runs BEFORE the Supabase client is created — imported ahead of ./App in
// main.tsx, so its synchronous top-level code executes while supabase.ts is
// still being pulled in. Why it must: the Supabase client is configured
// `detectSessionInUrl: true` + `flowType: "pkce"` (src/supabase.ts), so on ANY
// load it consumes a `?code=` query param as its OWN auth code and strips it
// from the URL. Polar's OAuth return also lands as `?code=…` (at the app root),
// so without this the two race and Supabase eats Polar's code before the Polar
// handler can. Here we detect a Polar return by its `state` marker, stash the
// code + returned state in sessionStorage, and strip the query (incl. an
// `?error=` denial) so Supabase never acts on it; completePolarAuth()
// (imports/providers/polar.ts) picks it up and validates the state.
//
// Web-only feature, but this guard is cheap and platform-agnostic: a native
// webview URL never carries these params, so it's a no-op there.

// State format is `polar_import:<nonce>`: the prefix distinguishes our return
// from Supabase's own ?code= flow (Supabase never sets this prefix), and the
// per-connect random nonce is the CSRF guard — completePolarAuth requires the
// returned state to equal the nonce THIS browser generated at connect() time,
// so a forged link carrying someone else's code can't be exchanged.
export const POLAR_STATE_PREFIX = "polar_import";
export const POLAR_CODE_KEY = "rc_polar_oauth_code";
export const POLAR_RETURNED_STATE_KEY = "rc_polar_oauth_state";
export const POLAR_NONCE_KEY = "rc_polar_oauth_nonce";

try {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const state = params.get("state");
    if (state && state.startsWith(POLAR_STATE_PREFIX + ":")) {
      // A Polar OAuth return (success carries `code`; a denial carries `error`
      // and no code). Stash a code for completePolarAuth to validate + exchange.
      const code = params.get("code");
      if (code) {
        try {
          sessionStorage.setItem(POLAR_CODE_KEY, code);
          sessionStorage.setItem(POLAR_RETURNED_STATE_KEY, state);
        } catch { /* storage unavailable — non-fatal */ }
      }
      // Strip our params (and any denial error) so Supabase never sees a `code`
      // and the address bar doesn't keep a stale ?code=/?error= around.
      const url = new URL(window.location.href);
      for (const k of ["code", "state", "error", "error_description"]) url.searchParams.delete(k);
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  }
} catch { /* never block boot on a URL/storage quirk */ }
