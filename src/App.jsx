import { useEffect, useRef, useState } from "react";
import { Loader } from "lucide-react";
import { supabase } from "./supabase";
import { initStore, clearStore } from "./db";
import RunningCoach from "./RunningCoach.jsx";
import LoginScreen from "./LoginScreen.jsx";

// How long to wait for the initial auth check before assuming it has hung
// (e.g. a stalled PKCE code-exchange after an OAuth redirect) and recovering.
const AUTH_INIT_TIMEOUT_MS = 8000;
// One-shot guard (per tab) so the recovery reload happens at most once.
const RECOVERY_KEY = "auth-init-recovered";

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
  // Which user id the store is currently loaded for. Guards against reloading
  // (and clobbering the in-memory cache) on every auth event — Supabase fires
  // onAuthStateChange on token refresh, tab refocus, and repeat SIGNED_IN, each
  // time with a brand-new session object.
  const loadedUidRef = useRef(null);

  // Track the auth session.
  useEffect(() => {
    let settled = false;
    // Mark the auth state as known. Clearing the recovery guard on every
    // successful resolution means a future hang (e.g. another OAuth redirect)
    // can trigger recovery again.
    const settle = (s) => {
      settled = true;
      try {
        sessionStorage.removeItem(RECOVERY_KEY);
      } catch {
        /* sessionStorage may be unavailable (private mode) — ignore */
      }
      setSession(s);
    };

    supabase.auth
      .getSession()
      .then(({ data }) => settle(data.session))
      .catch((err) => {
        // A *rejected* getSession() would otherwise leave `session` stuck at
        // `undefined` (infinite <Splash/>) with no trace. Log it and let the
        // safety net below recover rather than swallowing it silently.
        console.error("Initial getSession() failed", err);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      settle(s);
    });

    // Safety net for a hung initial auth check. After an OAuth (PKCE) redirect,
    // supabase-js exchanges the `?code=` param for a session inside its
    // one-shot initialize() promise; both getSession() and onAuthStateChange
    // await that same promise. The token-exchange request has no client-side
    // timeout, so if it hangs neither callback ever fires and the app is stuck
    // on the spinner forever — even though the session is usually already
    // persisted to localStorage (which is why a manual refresh fixes it).
    // Automate that refresh once, then fall back to the login screen so we
    // never spin or reload-loop indefinitely.
    const timer = setTimeout(() => {
      if (settled) return;
      let recovered = false;
      try {
        recovered = sessionStorage.getItem(RECOVERY_KEY) === "1";
      } catch {
        /* sessionStorage unavailable — skip the reload, fall through below */
      }
      if (!recovered) {
        console.warn("Auth init stalled; reloading to recover persisted session");
        try {
          sessionStorage.setItem(RECOVERY_KEY, "1");
        } catch {
          /* ignore */
        }
        window.location.reload();
      } else {
        // Already reloaded once and still stuck — stop trying and let the user
        // sign in again instead of looping.
        console.error("Auth init still stalled after reload; showing login");
        settle(null);
      }
    }, AUTH_INIT_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load (or clear) the per-user store when the *user* changes. Keyed on the
  // user id, not the session object, so token refresh / refocus events don't
  // re-run initStore and overwrite the in-memory cache with stale DB data.
  useEffect(() => {
    if (session === undefined) return;
    let cancelled = false;
    if (session) {
      if (loadedUidRef.current === session.user.id) return; // already loaded
      loadedUidRef.current = session.user.id;
      setStoreReady(false);
      initStore(session.user.id).then(() => {
        if (!cancelled) setStoreReady(true);
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
  if (!session) return <LoginScreen />;
  if (!storeReady) return <Splash />;
  return <RunningCoach onSignOut={() => supabase.auth.signOut()} />;
}
