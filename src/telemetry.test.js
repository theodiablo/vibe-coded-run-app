import { describe, it, expect, beforeEach } from "vitest";
import {
  TELEMETRY_CONSENT_KEY,
  getConsent,
  setConsent,
  isTelemetryConfigured,
  track,
  captureError,
  identifyUser,
} from "./telemetry";

// Consent is the security boundary here: nothing should ship without it, and
// the opt-out default (absent flag == on) has to hold so the Settings toggle
// reads correctly for users who never touched it.
describe("telemetry consent", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to consented when no flag is stored (opt-out model)", () => {
    expect(getConsent()).toBe(true);
  });

  it("persists an explicit opt-out as '0' and reflects it", () => {
    setConsent(false);
    expect(localStorage.getItem(TELEMETRY_CONSENT_KEY)).toBe("0");
    expect(getConsent()).toBe(false);
  });

  it("re-enabling clears the opt-out", () => {
    setConsent(false);
    setConsent(true);
    expect(getConsent()).toBe(true);
  });
});

// Until a real provider is wired into telemetry.js the whole module is inert —
// no key, no network, and every entry point is a safe no-op. Guards the "ships
// disabled by default" contract.
describe("telemetry without a provider", () => {
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
