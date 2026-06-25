import { describe, it, expect, beforeEach } from "vitest";
import {
  TELEMETRY_CONSENT_KEY,
  getConsent,
  getConsentDecision,
  setConsent,
  isTelemetryConfigured,
  track,
  captureError,
  identifyUser,
} from "./index";

// Consent is the security boundary here: nothing ships without it. Opt-in model
// (EU/ePrivacy) — an absent flag means "undecided", which must read as NOT
// consented so the SDK never inits before the first-run banner is answered.
describe("telemetry consent", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to NOT consented and 'unset' when no flag is stored (opt-in)", () => {
    expect(getConsent()).toBe(false);
    expect(getConsentDecision()).toBe("unset");
  });

  it("persists an explicit grant as '1' and reflects it", () => {
    setConsent(true);
    expect(localStorage.getItem(TELEMETRY_CONSENT_KEY)).toBe("1");
    expect(getConsent()).toBe(true);
    expect(getConsentDecision()).toBe("granted");
  });

  it("persists an explicit decline as '0' (distinct from undecided)", () => {
    setConsent(false);
    expect(localStorage.getItem(TELEMETRY_CONSENT_KEY)).toBe("0");
    expect(getConsent()).toBe(false);
    expect(getConsentDecision()).toBe("denied");
  });

  it("can be toggled back off after being granted", () => {
    setConsent(true);
    setConsent(false);
    expect(getConsent()).toBe(false);
    expect(getConsentDecision()).toBe("denied");
  });
});

// Without VITE_POSTHOG_KEY the adapter is unconfigured, so the whole module is
// inert — no SDK load, no network, every entry point a safe no-op. Guards the
// "ships disabled by default" contract (and keeps this suite from touching
// posthog-js).
describe("telemetry without a key", () => {
  it("reports itself as unconfigured", () => {
    expect(isTelemetryConfigured()).toBe(false);
  });

  it("never throws from the public API", () => {
    expect(() => {
      identifyUser("u1");
      track("some_event", { a: 1 });
      captureError(new Error("boom"), { kind: "test" });
    }).not.toThrow();
  });
});
