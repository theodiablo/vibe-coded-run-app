import { useEffect, useRef, useState } from "react";
import { Loader } from "lucide-react";
import { supabase } from "./supabase";
import { initStore, clearStore } from "./db";
import RunningCoach from "./RunningCoach.jsx";
import LoginScreen from "./LoginScreen.jsx";

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
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
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
