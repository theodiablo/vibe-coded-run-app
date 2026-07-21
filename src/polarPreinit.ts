// Runs BEFORE the Supabase client is created — imported ahead of ./App in
// main.tsx, so its synchronous top-level code executes while supabase.ts is
// still being pulled in. Why it must: the Supabase client is configured
// `detectSessionInUrl: true` + `flowType: "pkce"` (src/supabase.ts), so on ANY
// load it consumes a `?code=` query param as its OWN auth code and strips it
// from the URL. Polar's OAuth return also lands as `?code=…` (at the app root),
// so without this the two race and Supabase eats Polar's code before the Polar
// handler can. Here we detect a Polar return by its `state` marker, stash the
// code in sessionStorage, and strip the query so Supabase never acts on it;
// completePolarAuth() (imports/providers/polar.ts) picks it up from there.
//
// Web-only feature, but this guard is cheap and platform-agnostic: a native
// webview URL never carries these params, so it's a no-op there.
export const POLAR_STATE = "polar_import";
export const POLAR_CODE_KEY = "rc_polar_oauth_code";

try {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("state") === POLAR_STATE) {
      const code = params.get("code");
      if (code) {
        try { sessionStorage.setItem(POLAR_CODE_KEY, code); } catch { /* storage unavailable — non-fatal */ }
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("code");
      url.searchParams.delete("state");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  }
} catch { /* never block boot on a URL/storage quirk */ }
