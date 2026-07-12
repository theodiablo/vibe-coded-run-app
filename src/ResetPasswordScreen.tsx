import { useState, type FormEvent } from "react";
import { Loader, Lock } from "lucide-react";
import { BrandLogo } from "./components/BrandLogo";
import { supabase } from "./supabase";

// Shown by App when a password-recovery link lands (PASSWORD_RECOVERY auth
// event): the link has already signed the user in; this screen just sets the
// new password before letting them through to the app. Skippable on purpose —
// the recovery session is a real session, so "not now" simply continues.
export default function ResetPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password !== confirm) { setErr("Passwords don't match."); return; }
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onDone();
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-6">
          <BrandLogo className="text-orange-400" size={26} />
          <h1 className="text-xl font-bold text-white">Running Coach</h1>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 shadow-xl">
          <h2 className="text-white font-semibold mb-1">Set a new password</h2>
          <p className="text-sm text-slate-400 mb-4">You&apos;re signed in via your reset link — choose a new password to finish.</p>

          <form onSubmit={onSubmit} className="space-y-3">
            <label className="block">
              <span className="text-xs text-slate-400">New password</span>
              <div className="mt-1 flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3">
                <Lock size={16} className="text-slate-500" />
                <input type="password" required minLength={8} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex-1 bg-transparent py-2 text-sm text-white outline-none"
                  placeholder="••••••••" />
              </div>
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Confirm password</span>
              <div className="mt-1 flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3">
                <Lock size={16} className="text-slate-500" />
                <input type="password" required minLength={8} value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="flex-1 bg-transparent py-2 text-sm text-white outline-none"
                  placeholder="••••••••" />
              </div>
            </label>

            <button type="submit" disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition">
              {busy && <Loader size={16} className="animate-spin" />}
              Save new password
            </button>
            <button type="button" onClick={onDone}
              className="w-full text-xs text-slate-400 hover:text-slate-200 transition text-center">
              Not now — continue to the app
            </button>
            {err && <p className="text-sm text-center text-red-400">{err}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}
