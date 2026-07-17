import { beforeEach, describe, it, expect, vi } from "vitest";

// Stub both feature sources so nothing touches a real plugin. The coordinator's
// job is purely to orchestrate one consent + reconcile each feature's marker.
vi.mock("../hr/healthconnect", () => ({
  healthConnectSource: {
    requestPermissions: vi.fn(),
    checkPermissions: vi.fn(),
  },
}));
vi.mock("../watch/import", () => ({
  watchImportSource: {
    availability: vi.fn(),
    requestPermissions: vi.fn(),
    checkPermissions: vi.fn(),
  },
}));

import { connectHealthConnect } from "./connect";
import { healthConnectSource } from "../hr/healthconnect";
import { watchImportSource } from "../watch/import";

const hc = healthConnectSource as unknown as {
  requestPermissions: ReturnType<typeof vi.fn>;
  checkPermissions: ReturnType<typeof vi.fn>;
};
const watch = watchImportSource as unknown as {
  availability: ReturnType<typeof vi.fn>;
  requestPermissions: ReturnType<typeof vi.fn>;
  checkPermissions: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  hc.requestPermissions.mockReset().mockResolvedValue(true);
  hc.checkPermissions.mockReset().mockResolvedValue(true);
  watch.availability.mockReset().mockResolvedValue("Available");
  watch.requestPermissions.mockReset().mockResolvedValue(true);
  watch.checkPermissions.mockReset().mockResolvedValue(true);
});

describe("connectHealthConnect", () => {
  it("requests every scope once and reflects a full grant on both features", async () => {
    const grant = await connectHealthConnect();
    expect(grant).toEqual({ availability: "Available", heartRate: true, activity: true });
    // One consent screen (the watch plugin lists all four record types).
    expect(watch.requestPermissions).toHaveBeenCalledTimes(1);
    // Each feature reconciled independently against the real grant.
    expect(hc.checkPermissions).toHaveBeenCalledTimes(1);
    expect(watch.checkPermissions).toHaveBeenCalledTimes(1);
  });

  it("reflects a partial grant per feature (HR kept, activity declined)", async () => {
    hc.checkPermissions.mockResolvedValue(true);
    watch.checkPermissions.mockResolvedValue(false);
    const grant = await connectHealthConnect();
    expect(grant).toEqual({ availability: "Available", heartRate: true, activity: false });
  });

  it("still reconciles when the consent request throws (never throws)", async () => {
    watch.requestPermissions.mockRejectedValue(new Error("bridge dropped"));
    hc.checkPermissions.mockResolvedValue(true);
    watch.checkPermissions.mockResolvedValue(true);
    const grant = await connectHealthConnect();
    expect(grant).toEqual({ availability: "Available", heartRate: true, activity: true });
  });

  it("routes NotInstalled through the HR plugin's Play-store install redirect", async () => {
    watch.availability.mockResolvedValue("NotInstalled");
    hc.requestPermissions.mockResolvedValue(true);
    const grant = await connectHealthConnect();
    // The HR plugin is the one that can open Google Play; activity can't be
    // granted through its HR-only request.
    expect(hc.requestPermissions).toHaveBeenCalledTimes(1);
    expect(watch.requestPermissions).not.toHaveBeenCalled();
    expect(grant).toEqual({ availability: "NotInstalled", heartRate: true, activity: false });
  });

  it("does nothing but report when Health Connect is unsupported", async () => {
    watch.availability.mockResolvedValue("NotSupported");
    const grant = await connectHealthConnect();
    expect(grant).toEqual({ availability: "NotSupported", heartRate: false, activity: false });
    expect(hc.requestPermissions).not.toHaveBeenCalled();
    expect(watch.requestPermissions).not.toHaveBeenCalled();
    expect(hc.checkPermissions).not.toHaveBeenCalled();
    expect(watch.checkPermissions).not.toHaveBeenCalled();
  });
});
