import { useEffect, useState } from "react";
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

  // Track the auth session.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load (or clear) the per-user store whenever the session changes.
  useEffect(() => {
    if (session === undefined) return;
    let cancelled = false;
    if (session) {
      setStoreReady(false);
      initStore(session.user.id).then(() => {
        if (!cancelled) setStoreReady(true);
      });
    } else {
      clearStore();
      setStoreReady(false);
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
