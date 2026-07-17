import { beforeEach, describe, it, expect, vi } from "vitest";
import { REC_NOTIF_ASKED_KEY } from "../constants";

// Force the Android path on and stub the native RunPermissions bridge.
vi.mock("../native", () => ({ isNative: true, isAndroid: true, isIos: false, platform: "android" }));
const native = { checkNotifications: vi.fn(), requestNotifications: vi.fn() };
vi.mock("@capacitor/core", () => ({ registerPlugin: () => native }));

import { requestRunNotifications, requestRunNotificationsOnce } from "./notifications";

beforeEach(() => {
  localStorage.clear();
  native.requestNotifications.mockReset().mockResolvedValue({ granted: true });
});

describe("requestRunNotifications", () => {
  it("resolves to the native granted flag", async () => {
    native.requestNotifications.mockResolvedValue({ granted: true });
    expect(await requestRunNotifications()).toBe(true);
  });

  it("resolves false when access is denied", async () => {
    native.requestNotifications.mockResolvedValue({ granted: false });
    expect(await requestRunNotifications()).toBe(false);
  });

  it("never throws on a bridge failure", async () => {
    native.requestNotifications.mockRejectedValue(new Error("boom"));
    expect(await requestRunNotifications()).toBe(false);
  });
});

describe("requestRunNotificationsOnce", () => {
  it("asks once, then sets the flag so it never re-nags", async () => {
    await requestRunNotificationsOnce();
    expect(native.requestNotifications).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(REC_NOTIF_ASKED_KEY)).toBe("1");

    await requestRunNotificationsOnce();
    expect(native.requestNotifications).toHaveBeenCalledTimes(1); // not called again
  });

  it("does nothing when the flag is already set", async () => {
    localStorage.setItem(REC_NOTIF_ASKED_KEY, "1");
    await requestRunNotificationsOnce();
    expect(native.requestNotifications).not.toHaveBeenCalled();
  });
});
