import { describe, it, expect, vi, beforeEach } from "vitest";
import { Geolocation } from "@capacitor/geolocation";
import { adaptBgLocation, adaptBgError, ensureForegroundPermission } from "./native";

vi.mock("@capacitor/geolocation", () => ({
  Geolocation: { checkPermissions: vi.fn(), getCurrentPosition: vi.fn() },
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => ({}) }));

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

// Regression coverage for the "no permission prompt at all" bug: on Android,
// Geolocation.checkPermissions()/requestPermissions() reject immediately with
// "location services disabled" BEFORE ever showing the OS dialog when the
// device's system Location toggle is off. ensureForegroundPermission must fall
// back to a real getCurrentPosition() probe in that case — that call has no such
// gate, so it's the one that actually surfaces the permission + "turn on
// location" dialogs.
describe("ensureForegroundPermission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true on the fast path when already granted", async () => {
    Geolocation.checkPermissions.mockResolvedValue({ location: "granted" });
    await expect(ensureForegroundPermission()).resolves.toBe(true);
    expect(Geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("falls back to getCurrentPosition when checkPermissions rejects (location services off)", async () => {
    Geolocation.checkPermissions.mockRejectedValue(
      Object.assign(new Error("Location services are not enabled."), { code: "OS-PLUG-GLOC-0007" }),
    );
    Geolocation.getCurrentPosition.mockResolvedValue({ coords: { latitude: 1, longitude: 2 } });
    await expect(ensureForegroundPermission()).resolves.toBe(true);
    expect(Geolocation.getCurrentPosition).toHaveBeenCalled();
  });

  it("falls back to getCurrentPosition when checkPermissions resolves not-granted", async () => {
    Geolocation.checkPermissions.mockResolvedValue({ location: "denied" });
    Geolocation.getCurrentPosition.mockResolvedValue({ coords: { latitude: 1, longitude: 2 } });
    await expect(ensureForegroundPermission()).resolves.toBe(true);
  });

  it("returns false (not a dead-end throw) when the fallback probe also fails", async () => {
    Geolocation.checkPermissions.mockRejectedValue(new Error("Location services are not enabled."));
    Geolocation.getCurrentPosition.mockRejectedValue(new Error("Request to enable location was denied."));
    await expect(ensureForegroundPermission()).resolves.toBe(false);
  });
});
