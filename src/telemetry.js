// Vendor-agnostic telemetry (analytics + crash reporting) seam.
//
// Nothing ever leaves the device unless BOTH are true:
//   1. a provider is wired in below AND its key env var is set
//      (isTelemetryConfigured()), and
//   2. the user has consented.
//
// Consent is opt-out: on by default, with a Settings toggle the user can flip
// off (and back on) at any time. Native crashes get an *additional* per-crash
// "send report?" prompt (see ErrorBoundary), so a crash is never uploaded
// without an explicit, in-the-moment OK even when analytics consent is on.
//
// Until a provider is chosen this module is fully inert — every call is a
// no-op, exactly like the map records fine without a MapTiler key. That's
// deliberate: the consent machinery ships first, and a real SDK (Sentry /
// PostHog / …) slots into `provider` below without the rest of the app
// changing. See docs/telemetry.md for how to plug one in.

import { isNative } from "./native";

// localStorage so consent is known *synchronously at boot*, before the Supabase
// app_state blob loads (same reason the live-run/bg-location flags live there).
// The source of truth for the UI is settings.analyticsEnabled; RunningCoach
// mirrors it here whenever settings load or the toggle changes.
export const TELEMETRY_CONSENT_KEY = "rc_telemetry_consent";

// ---- Provider seam -------------------------------------------------------
// Replace `provider` with a real adapter to enable telemetry. Keep it the ONLY
// place an SDK is imported, so everything below stays vendor-neutral. The
// adapter must implement:
//
//   isConfigured(): boolean              key present in env, safe to init
//   init(): void                         start the SDK (once consent is given)
//   shutdown(): void                     stop/flush the SDK (on opt-out)
//   identify(id): void
//   reset(): void
//   track(event, props): void
//   captureError(error, context): void
//
const noopProvider = {
  isConfigured: () => false,
  init() {},
  shutdown() {},
  identify() {},
  reset() {},
  track() {},
  captureError() {},
};

const provider = noopProvider;

// ---- Consent -------------------------------------------------------------
let started = false;

// Opt-out model: an absent flag counts as consented; a stored "0" is an
// explicit opt-out. Wrapped in try/catch because storage can be unavailable
// (private mode / locked) — in which case the safe default is "off".
export function getConsent() {
  try {
    return localStorage.getItem(TELEMETRY_CONSENT_KEY) !== "0";
  } catch {
    return false;
  }
}

// Whether a real provider is wired in AND keyed. The Settings toggle still
// renders regardless (so the choice is always visible), but flipping it is
// inert until this is true.
export function isTelemetryConfigured() {
  return provider.isConfigured();
}

function start() {
  if (started || !provider.isConfigured()) return;
  provider.init();
  started = true;
}

function stop() {
  if (!started) return;
  provider.shutdown();
  started = false;
}

// Called once at app start (main.jsx) and again whenever consent changes.
export function initTelemetry() {
  if (provider.isConfigured() && getConsent()) start();
}

// Persist the user's choice and start/stop the provider to match. Called from
// the Settings toggle (via RunningCoach mirroring settings.analyticsEnabled).
export function setConsent(enabled) {
  try {
    localStorage.setItem(TELEMETRY_CONSENT_KEY, enabled ? "1" : "0");
  } catch { /* storage unavailable — getConsent() will fall back to off */ }
  if (enabled) start();
  else stop();
}

// ---- Identity ------------------------------------------------------------
export function identifyUser(id) {
  if (!started || !getConsent()) return;
  provider.identify(id);
}

export function resetUser() {
  if (!started) return;
  provider.reset();
}

// ---- Events --------------------------------------------------------------
// Analytics events. Silently dropped without a provider or consent.
export function track(event, props) {
  if (!started || !getConsent()) return;
  provider.track(event, props || {});
}

// ---- Crash reporting -----------------------------------------------------
// Low-level "send this error to the provider". Does NOT check consent itself —
// the call sites do, so the rules stay explicit:
//   • web: ErrorBoundary / global handlers call this only when getConsent().
//   • native: the crash screen calls this ONLY after the user taps "Send
//     report", so a crash is never reported without an explicit per-crash OK
//     (even if analytics consent is already on).
export function captureError(error, context) {
  if (!provider.isConfigured()) return;
  // The native "send this one report" path may reach here with the SDK not yet
  // started (analytics consent off); bring it up so it can take the error.
  start();
  provider.captureError(error, context || {});
}

// ---- Global handlers (web only) -----------------------------------------
// Foreground browser errors that never reach the React ErrorBoundary (event
// handlers, async callbacks, rejected promises). Consent-gated at fire time.
// Left off on native: there we rely on the per-crash prompt (and, later, the
// native SDK's own beforeSend hook) so a background error can't ship without
// the user's in-the-moment choice.
let handlersInstalled = false;
export function installGlobalErrorHandlers() {
  if (handlersInstalled || typeof window === "undefined" || isNative) return;
  handlersInstalled = true;
  window.addEventListener("error", (e) => {
    if (getConsent()) {
      captureError(e.error || new Error(e.message), { kind: "window.error" });
    }
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (getConsent()) {
      const err = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
      captureError(err, { kind: "unhandledrejection" });
    }
  });
}
