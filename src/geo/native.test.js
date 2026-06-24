import { describe, it, expect } from "vitest";
import { adaptBgLocation, adaptBgError } from "./native";

// The native background-geolocation plugin hands us a flat `location` object; the
// rest of the tracker (onPos, accuracyOK) reads the GeolocationPosition shape.
// These pure adapters bridge the two — verify the mapping so a plugin field
// rename can't silently break recording.
describe("adaptBgLocation", () => {
  it("maps plugin fields onto coords + timestamp", () => {
    const pos = adaptBgLocation({
      latitude: 48.8584, longitude: 2.2945, accuracy: 7, altitude: 35,
      altitudeAccuracy: 3, bearing: 90, speed: 2.5, time: 1700000000000,
    });
    expect(pos.coords.latitude).toBe(48.8584);
    expect(pos.coords.longitude).toBe(2.2945);
    expect(pos.coords.accuracy).toBe(7);
    expect(pos.coords.altitude).toBe(35);
    expect(pos.coords.heading).toBe(90); // bearing → heading
    expect(pos.timestamp).toBe(1700000000000);
  });

  it("keeps null altitude/accuracy null (some phones omit them)", () => {
    const pos = adaptBgLocation({ latitude: 1, longitude: 2, altitude: null, accuracy: null });
    expect(pos.coords.altitude).toBeNull();
    expect(pos.coords.accuracy).toBeNull();
  });

  it("falls back to now when the plugin omits a timestamp", () => {
    const before = Date.now();
    const pos = adaptBgLocation({ latitude: 1, longitude: 2 });
    expect(pos.timestamp).toBeGreaterThanOrEqual(before);
  });
});

describe("adaptBgError", () => {
  it("maps NOT_AUTHORIZED to a PERMISSION_DENIED-coded error", () => {
    const err = adaptBgError({ code: "NOT_AUTHORIZED", message: "denied" });
    // onErr in useRunTracker reads `err.code === err.PERMISSION_DENIED`.
    expect(err.code).toBe(err.PERMISSION_DENIED);
    expect(err.message).toBe("denied");
  });

  it("maps other errors to POSITION_UNAVAILABLE", () => {
    const err = adaptBgError({ code: "SOMETHING_ELSE" });
    expect(err.code).toBe(err.POSITION_UNAVAILABLE);
  });
});
