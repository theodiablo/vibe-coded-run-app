// PostHog adapter for the telemetry seam (./index.js). This is the ONLY file
// that imports the SDK, so the rest of the app stays vendor-neutral.
//
// posthog-js is pulled in by a dynamic import the first time telemetry actually
// activates, so it never weighs down the main bundle — or any build that ships
// without a key. Calls made before that import resolves are queued and replayed
// in order once it lands.

import { isNative } from "../native";

const KEY = import.meta.env.VITE_POSTHOG_KEY || "";
// Default to PostHog EU Cloud (privacy hosting, per the project's data-handling
// choice); override with VITE_POSTHOG_HOST for a different region/self-host.
const HOST = import.meta.env.VITE_POSTHOG_HOST || "https://eu.i.posthog.com";
// Tags every event so production / PR-preview / local traffic is filterable in
// PostHog. Set per build by the deploy workflows; "development" when unset
// (local). Vite's own MODE can't tell production from preview — both are a
// `vite build` — so this is an explicit var.
const ENV = import.meta.env.VITE_APP_ENV || "development";

let ph = null; // resolved posthog instance, once loaded + init'd
let loading = null; // in-flight dynamic import; null again if it fails (retryable)
const queue = []; // (posthog) => void calls deferred until the SDK is ready

function ensureLoaded() {
  if (ph || loading) return;
  loading = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        // No router in this app, so capture explicit events only — no
        // autocapture, no pageviews, no session recording. We also drive
        // opt-in/out ourselves from user consent (opt_out_capturing_by_default)
        // and send exceptions explicitly (capture_exceptions: false), so a
        // crash can never ship outside the consent rules in index.js /
        // ErrorBoundary.
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_exceptions: false,
        disable_session_recording: true,
        // Don't fetch PostHog's optional remote scripts (recorder, surveys,
        // toolbar, …). We use none of them, and this keeps the CSP tight: only
        // connect-src needs *.i.posthog.com, script-src stays 'self'. Event
        // capture + manual captureException are bundled, so they're unaffected.
        disable_external_dependency_loading: true,
        person_profiles: "identified_only",
        opt_out_capturing_by_default: true,
      });
      // Super properties — merged into every event, including $exception, so
      // crashes carry the environment/platform too.
      posthog.register({ environment: ENV, native: isNative });
      ph = posthog;
      queue.forEach((fn) => fn(ph));
      queue.length = 0;
    })
    .catch(() => { loading = null; }); // swallow load failures; never crash the app
}

// Run `fn` against the posthog instance now, or queue it until the SDK loads.
function withPH(fn) {
  if (ph) fn(ph);
  else { ensureLoaded(); queue.push(fn); }
}

export const posthogProvider = {
  isConfigured: () => !!KEY,

  // captureEventName:false suppresses PostHog's own $opt_in event so opting in
  // is silent (it would otherwise count as an event the user didn't trigger).
  init() {
    withPH((p) => p.opt_in_capturing({ captureEventName: false }));
  },

  shutdown() {
    if (ph) ph.opt_out_capturing();
  },

  identify(id) {
    withPH((p) => p.identify(id));
  },

  reset() {
    withPH((p) => p.reset());
  },

  track(event, props) {
    // `environment` and `native` ride along as super properties (see register).
    withPH((p) => p.capture(event, props));
  },

  // May be called while opted out — the native per-crash "Send report" path.
  // Opt in just long enough to send this one exception; we deliberately do NOT
  // re-opt-out synchronously (that can drop the still-queued report). It's safe:
  // the app is on the crash screen with no other events firing, and the next
  // reload re-reads the persisted opt-out and starts paused again.
  captureError(error, context) {
    withPH((p) => {
      if (p.has_opted_out_capturing()) {
        p.opt_in_capturing({ captureEventName: false });
      }
      p.captureException(error, context);
    });
  },
};
