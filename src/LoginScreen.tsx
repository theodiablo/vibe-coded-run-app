import { useState, type FormEvent } from "react";
import { Loader, Mail, Lock } from "lucide-react";
import { BrandLogo } from "./components/BrandLogo";
import { Browser } from "@capacitor/browser";
import { supabase, authRedirectTo } from "./supabase";
import { isNative } from "./native";
import { PRIVACY_URL } from "./constants";

// "reset" is the forgot-password sub-screen: email only, sends a recovery
// link (completed by ResetPasswordScreen after the PASSWORD_RECOVERY event).
type LoginMode = "signin" | "signup" | "reset";
type LoginMessage = { type: "err" | "ok"; text: string };
type LoginScreenProps = {
  authError?: string | null;
  onClearAuthError?: () => void;
  // Which tab to open on. Defaults to "signin"; the marketing "Get started"
  // CTAs pass "signup" so they land on account creation.
  initialMode?: LoginMode;
};

// `authError` is a native deep-link sign-in failure surfaced by App.jsx (e.g. the
// user cancels Google consent); shown until the user takes another action.
export default function LoginScreen({ authError, onClearAuthError, initialMode = "signin" }: LoginScreenProps) {
  const [mode, setMode] = useState<LoginMode>(initialMode); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<LoginMessage | null>(null); // { type: "err"|"ok", text }

  const note = (type: LoginMessage["type"], text: string) => { onClearAuthError?.(); setMsg({ type, text }); };
  // Local form messages take precedence; otherwise fall back to a deep-link error.
  const shownMsg = msg || (authError ? { type: "err", text: authError } : null);

  async function withGoogle() {
    setBusy(true);
    setMsg(null);
    // In the shell, open the provider in the system browser ourselves and let the
    // deep link bring the result back (App.jsx completes the exchange). On the web
    // Supabase performs the redirect for us.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: authRedirectTo(), skipBrowserRedirect: isNative },
    });
    if (error) {
      note("err", error.message);
      setBusy(false);
      return;
    }
    if (isNative && data?.url) {
      await Browser.open({ url: data.url });
      // The external tab handles the rest; the WebView itself is NOT redirected, so
      // re-enable the form. Otherwise dismissing/cancelling the OAuth tab (no
      // appUrlOpen, no auth event) would leave the UI locked until a restart. On
      // success, App.jsx's deep-link handler drives the transition to the app.
      setBusy(false);
      return;
    }
    // Web: the page itself is redirected to the provider, so leave busy=true.
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: authRedirectTo(),
        });
        if (error) throw error;
        note("ok", "Check your email for a password reset link.");
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: authRedirectTo() },
        });
        if (error) throw error;
        note("ok", "Account created. Check your email to confirm, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // onAuthStateChange in App handles the transition
      }
    } catch (err) {
      note("err", err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const tab = (id: LoginMode, label: string) => (
    <button
      type="button"
      onClick={() => { onClearAuthError?.(); setMode(id); setMsg(null); }}
      className={
        "flex-1 py-2 text-sm font-medium rounded-lg transition " +
        (mode === id ? "bg-orange-500 text-white" : "text-slate-400 hover:text-slate-200")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-6">
          <BrandLogo className="text-orange-400" size={26} />
          <h1 className="text-xl font-bold text-white">Running Coach</h1>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 shadow-xl">
          {mode !== "reset" && (
            <div className="flex gap-1 mb-4 bg-slate-900/60 p-1 rounded-xl">
              {tab("signin", "Sign in")}
              {tab("signup", "Sign up")}
            </div>
          )}
          {mode === "reset" && (
            <p className="text-sm text-slate-300 mb-4">
              Enter your account email and we&apos;ll send you a link to set a new password.
            </p>
          )}

          <form onSubmit={onSubmit} className="space-y-3">
            <label className="block">
              <span className="text-xs text-slate-400">Email</span>
              <div className="mt-1 flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3">
                <Mail size={16} className="text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1 bg-transparent py-2 text-sm text-white outline-none"
                  placeholder="you@example.com"
                />
              </div>
            </label>

            {mode !== "reset" && (
              <label className="block">
                <span className="text-xs text-slate-400">Password</span>
                <div className="mt-1 flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3">
                  <Lock size={16} className="text-slate-500" />
                  <input
                    type="password"
                    required
                    // Enforce the stronger policy on sign-up only; sign-in must
                    // still accept existing accounts created under the old rule.
                    minLength={mode === "signup" ? 8 : 6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="flex-1 bg-transparent py-2 text-sm text-white outline-none"
                    placeholder="••••••••"
                  />
                </div>
              </label>
            )}

            {mode === "signin" && (
              <div className="text-right">
                <button type="button"
                  onClick={() => { onClearAuthError?.(); setMode("reset"); setMsg(null); }}
                  className="text-xs text-slate-400 hover:text-slate-200 transition">
                  Forgot password?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition"
            >
              {busy && <Loader size={16} className="animate-spin" />}
              {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
            </button>

            {mode === "reset" && (
              <button type="button"
                onClick={() => { setMode("signin"); setMsg(null); }}
                className="w-full text-xs text-slate-400 hover:text-slate-200 transition text-center">
                Back to sign in
              </button>
            )}
          </form>

          {mode !== "reset" && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="h-px flex-1 bg-slate-700" />
                <span className="text-xs text-slate-500">or</span>
                <div className="h-px flex-1 bg-slate-700" />
              </div>

              <button
                type="button"
                onClick={withGoogle}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 bg-white hover:bg-slate-100 disabled:opacity-60 text-slate-800 font-medium py-2.5 rounded-lg transition"
              >
                <GoogleIcon />
                Continue with Google
              </button>
            </>
          )}

          {shownMsg && (
            <p
              className={
                "mt-4 text-sm text-center " +
                (shownMsg.type === "err" ? "text-red-400" : "text-emerald-400")
              }
            >
              {shownMsg.text}
            </p>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-4">
          Your data syncs securely to your account.{" "}
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer"
            className="text-slate-500 underline hover:text-slate-300">Privacy</a>
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.5 0 10.5-2.1 14.3-5.6l-6.6-5.6c-2.1 1.5-4.8 2.4-7.7 2.4-5.2 0-9.6-3.3-11.2-8l-6.6 5.1C9.6 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.6 5.6C40.9 36.4 44 30.7 44 24c0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
  );
}
