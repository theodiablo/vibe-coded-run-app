import { useState } from "react";
import {
  Activity,
  MapPin,
  Sparkles,
  Trophy,
  HeartPulse,
  BarChart3,
  X,
} from "lucide-react";
import LoginScreen from "../LoginScreen";
import { PRIVACY_URL } from "../constants";
// Brand + hero headline are shared with the OG-image generator (scripts/og-image)
// via this single source of truth, so the social card can't drift from the page.
import copy from "./copy.json";

// Web-only marketing landing shown at the root path to signed-out visitors.
// The native (Capacitor) shell never renders this — it goes straight to
// LoginScreen — and the build-time VITE_NATIVE_BUILD flag drops this whole
// chunk from the APK (see App.tsx). Logging in reuses the existing LoginScreen,
// opened as a full-screen modal, so every auth flow stays in one place.

type Feature = {
  icon: typeof Activity;
  title: string;
  body: string;
};

const FEATURES: Feature[] = [
  {
    icon: Activity,
    title: "Adaptive training plans",
    body: "Tell us your race and goal time — get a week-by-week plan that peaks and tapers for the day that matters, and rebuilds itself when life gets in the way.",
  },
  {
    icon: MapPin,
    title: "GPS run tracking",
    body: "Record your runs with live pace, distance and elevation on a map. Your route and splits are saved to every run automatically.",
  },
  {
    icon: Sparkles,
    title: "AI running coach",
    body: "Missed a week? Knee acting up? Chat with a coach that adjusts your plan safely — it edits the schedule, it never hands you a risky one.",
  },
  {
    icon: HeartPulse,
    title: "Heart-rate zones",
    body: "Pair a chest strap or pull heart rate from your watch, then see every run classified into training zones so you know if you went too hard.",
  },
  {
    icon: Trophy,
    title: "Races & badges",
    body: "Discover races near you, add the ones you're eyeing, and unlock gentle badges as your training weeks add up.",
  },
  {
    icon: BarChart3,
    title: "Progress you can see",
    body: "History, stats and trends in one place — your data syncs securely to your account and follows you to every device.",
  },
];

export default function MarketingGate() {
  const [showLogin, setShowLogin] = useState(false);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Top bar */}
      <header className="max-w-5xl mx-auto flex items-center justify-between px-4 sm:px-6 py-4">
        <div className="flex items-center gap-2">
          <Activity className="text-orange-400" size={24} />
          <span className="font-bold text-white">{copy.brand}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowLogin(true)}
          className="text-sm font-medium text-slate-300 hover:text-white transition"
        >
          Log in
        </button>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-12 pb-16 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight">
          {copy.heroLine1}
          <br className="hidden sm:block" />{" "}
          <span className="text-orange-400">{copy.heroLine2}</span>
        </h1>
        <p className="mt-5 max-w-2xl mx-auto text-lg text-slate-400">
          A running coach in your pocket: an adaptive plan built around your
          goal, GPS tracking for every run, and an AI coach that keeps you on
          track when things don't go to plan.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setShowLogin(true)}
            className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600 text-white font-medium px-8 py-3 rounded-lg transition"
          >
            Get started — it's free
          </button>
          <button
            type="button"
            onClick={() => setShowLogin(true)}
            className="w-full sm:w-auto text-slate-300 hover:text-white font-medium px-8 py-3 rounded-lg border border-slate-700 hover:border-slate-500 transition"
          >
            I already have an account
          </button>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-20">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="bg-slate-800 border border-slate-700 rounded-2xl p-5"
            >
              <Icon className="text-orange-400" size={22} />
              <h3 className="mt-3 font-semibold text-white">{title}</h3>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-20 text-center">
        <div className="bg-gradient-to-br from-slate-800 to-slate-800/40 border border-slate-700 rounded-3xl px-6 py-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">
            Ready to run your best race?
          </h2>
          <p className="mt-3 text-slate-400">
            Create a free account and get your training plan in minutes.
          </p>
          <button
            type="button"
            onClick={() => setShowLogin(true)}
            className="mt-6 bg-orange-500 hover:bg-orange-600 text-white font-medium px-8 py-3 rounded-lg transition"
          >
            Get started
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-4 sm:px-6 pb-10 text-center text-xs text-slate-600">
        <p>
          Your data syncs securely to your account.{" "}
          <a
            href={PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-500 underline hover:text-slate-300"
          >
            Privacy
          </a>
        </p>
      </footer>

      {/* Login modal — reuses the full LoginScreen over a backdrop. */}
      {showLogin && (
        <div className="fixed inset-0 z-50">
          <div className="relative min-h-screen">
            <button
              type="button"
              onClick={() => setShowLogin(false)}
              aria-label="Close sign in"
              className="absolute top-4 right-4 z-10 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X size={22} />
            </button>
            <LoginScreen />
          </div>
        </div>
      )}
    </div>
  );
}
