import { useState } from "react";
import { Shield } from "lucide-react";
import { PRIVACY_URL } from "../constants";
import {
  isTelemetryConfigured,
  getConsentDecision,
  setConsent,
} from "../telemetry";

// First-run opt-in consent banner (EU/ePrivacy): telemetry stays fully off
// until the user makes a choice here, so PostHog never inits — and never stores
// anything on the device — before consent. Self-gating: renders nothing unless
// telemetry is actually configured (a key is set) AND the user hasn't decided
// yet, so it disappears for good once Accept/Decline is tapped. The Settings →
// Privacy toggle remains the durable control to change the choice later.
//
// `onConsentChange(granted)` lets the host re-identify the signed-in user the
// moment they accept (events before that point are anonymous; later events use
// the signed-in user id).
export function ConsentBanner({ onConsentChange }) {
  const [show, setShow] = useState(
    () => isTelemetryConfigured() && getConsentDecision() === "unset"
  );
  if (!show) return null;

  const choose = (granted) => {
    setConsent(granted);
    setShow(false);
    if (onConsentChange) onConsentChange(granted);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4">
      <div className="max-w-lg mx-auto bg-slate-800 border border-slate-700 rounded-2xl shadow-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Shield size={15} className="text-orange-400 shrink-0" />
          <p className="text-sm font-semibold text-slate-200">
            Help improve the app?
          </p>
        </div>
        <p className="text-xs text-slate-400">
          We&apos;d like to collect limited usage analytics and crash reports to
          fix bugs and see what&apos;s used. No run data, routes, notes, or heart
          rate, or coach messages are ever sent. You can change this any time in Settings → Privacy.{" "}
          <a
            href={PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 hover:text-orange-300 underline"
          >
            Privacy policy
          </a>
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => choose(false)}
            className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
          >
            Decline
          </button>
          <button
            onClick={() => choose(true)}
            className="py-2.5 rounded-xl text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
