import { useEffect, useRef, useState } from "react";
import { Loader } from "lucide-react";
import { supabase } from "./supabase";
import { isNative } from "./native";
import { initStore, clearStore } from "./db";
import RunningCoach from "./RunningCoach.jsx";
import LoginScreen from "./LoginScreen.jsx";

// Defensive cap on the initial auth resolution. Supabase requests are already
// bounded by the fetch timeout in supabase.js, so getSession() should always
// settle well within this; it exists only so a never-resolving auth check can
// never leave the user staring at the splash spinner forever.
const AUTH_INIT_TIMEOUT_MS = 20000;

function Splash() {
  return (
    <div className="h-screen bg-slate-900 flex items-center justify-center">
      <Loader className="text-orange-400 animate-spin" size={32} />
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still resolving
  const [storeReady, setStoreReady] = useState(false);
  const [authError, setAuthError] = useState(null); // native deep-link sign-in failure
  // Which user id the store is currently loaded for. Guards against reloading
  // (and clobbering the in-memory cache) on every auth event — Supabase fires
  // onAuthStateChange on token refresh, tab refocus, and repeat SIGNED_IN, each
  // time with a brand-new session object.
  const loadedUidRef = useRef(null);

  // Track the auth session.
  useEffect(() => {
    let active = true;
    const settle = (s) => {
      if (active) setSession(s);
    };

    supabase.auth
      .getSession()
      .then(({ data }) => settle(data.session))
      .catch((err) => {
        // A *rejected* getSession() would otherwise leave `session` stuck at
        // `undefined` (infinite <Splash/>). Log it and fall back to the login
        // screen so the user can retry rather than being stranded.
        console.error("Initial getSession() failed", err);
        settle(null);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      settle(s);
    });

    // Belt-and-suspenders: if the auth state is somehow still unresolved after
    // the cap (requests are already bounded by the fetch timeout in
    // supabase.js), drop to the login screen instead of spinning forever.
    const timer = setTimeout(() => {
      setSession((curr) => {
        if (curr !== undefined) return curr;
        console.error("Auth init did not settle in time; showing login");
        return null;
      });
    }, AUTH_INIT_TIMEOUT_MS);

    return () => {
      active = false;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  // Inside the Capacitor shell, OAuth / magic-link redirects come back as a deep
  // link (see authRedirectTo). Complete the PKCE exchange so the WebView signs in.
  // No-op on the web (handled by detectSessionInUrl). Plugin imported lazily so it
  // stays out of the web bundle.
  useEffect(() => {
    if (!isNative) return;
    let listener;
    let lastUrl = null;

    // Surface an auth failure on the login screen (passed down as a prop). When
    // there's no session, LoginScreen is rendered as our child, so this re-render
    // reaches it for both the warm-return and cold-start cases.
    const reportAuthError = (text) => setAuthError(text);

    const processUrl = async (url) => {
      if (!url || url === lastUrl) return; // de-dupe appUrlOpen vs getLaunchUrl
      lastUrl = url;
      let params;
      try { params = new URL(url).searchParams; } catch { return; }
      // Provider-side denial/error (e.g. user cancels Google consent) carries no
      // `code` — surface it instead of silently no-oping.
      const provErr = params.get("error_description") || params.get("error");
      if (provErr) { reportAuthError(provErr); return; }
      const code = params.get("code");
      if (!code) return; // not an auth callback
      try {
        await supabase.auth.exchangeCodeForSession(code);
      } catch (err) {
        console.error("Deep-link auth exchange failed", err);
        reportAuthError(err?.message || "Sign-in failed. Please try again.");
      }
    };

    import("@capacitor/app").then(async ({ App: CapApp }) => {
      listener = await CapApp.addListener("appUrlOpen", ({ url }) => processUrl(url));
      // Cold start: when the OS kills the app while the OAuth tab is open, the
      // callback intent that relaunches MainActivity is delivered as the launch
      // URL, not as appUrlOpen — so read it explicitly once on mount.
      const launch = await CapApp.getLaunchUrl();
      if (launch?.url) processUrl(launch.url);
    });

    return () => { listener?.remove?.(); };
  }, []);

  // Load (or clear) the per-user store when the *user* changes. Keyed on the
  // user id, not the session object, so token refresh / refocus events don't
  // re-run initStore and overwrite the in-memory cache with stale DB data.
  useEffect(() => {
    if (session === undefined) return;
    let cancelled = false;
    if (session) {
      if (loadedUidRef.current === session.user.id) return; // already loaded
      setStoreReady(false);
      initStore(session.user.id).then(() => {
        if (!cancelled) {
          loadedUidRef.current = session.user.id;
          setStoreReady(true);
        }
      });
    } else {
      // Signed out: drop the in-memory store and forget which user it held.
      // No need to reset storeReady here — we render <LoginScreen/> whenever
      // there's no session, and the next sign-in resets it before reloading.
      loadedUidRef.current = null;
      clearStore();
    }
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (session === undefined) return <Splash />;
  if (!session) return <LoginScreen authError={authError} onClearAuthError={() => setAuthError(null)} />;
  if (!storeReady) return <Splash />;
  return <RunningCoach onSignOut={() => supabase.auth.signOut()} />;
}
