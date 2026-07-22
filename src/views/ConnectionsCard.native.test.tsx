import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// Android shell: the BLE row + the Health Connect row render; the web pointer
// does not. Health sources are mocked at the module seam so no Capacitor
// bridge is touched.
vi.mock("../native", () => ({ isNative: true, isAndroid: true, isIos: false, platform: "android" }));
vi.mock("../hr/healthconnect", () => ({
  healthConnectSource: { checkPermissions: vi.fn(async () => true) },
}));
vi.mock("../hr/healthkit", () => ({
  healthKitSource: {
    checkPermissions: vi.fn(async () => false),
    isAvailable: vi.fn(async () => false),
    requestPermissions: vi.fn(async () => false),
  },
}));
import { connectHealthConnect } from "../health/connect";
vi.mock("../health/connect", () => ({
  connectHealthConnect: vi.fn(async () => ({ availability: "Available", heartRate: true, activity: true })),
}));
vi.mock("../hr/ble", () => ({
  bleSource: { scan: vi.fn(async () => {}), requestPermissions: vi.fn(async () => true) },
}));

import { ConnectionsCard } from "./ConnectionsCard";
import type { SettingsState } from "../types";

afterEach(() => { cleanup(); localStorage.clear(); });

describe("ConnectionsCard (Android shell)", () => {
  it("renders BLE + Health Connect rows, no web pointer, and per-feature toggles once granted", async () => {
    render(<ConnectionsCard settings={{} as SettingsState} saveSettings={() => {}} />);
    expect(screen.getByText("Bluetooth heart-rate sensor")).toBeInTheDocument();
    expect(screen.getByText("Health Connect")).toBeInTheDocument();
    // Only this platform's store — never the other one's.
    expect(screen.queryByText("Apple Health")).toBeNull();
    expect(screen.queryByRole("link", { name: "Get it on Google Play" })).toBeNull();
    // checkPermissions resolves true → the row is connected and exposes the
    // two per-feature sub-toggles (the old two-sections-both-saying-Health-
    // Connect layout collapsed into one row).
    await waitFor(() => {
      expect(screen.getByText("Heart rate after runs")).toBeInTheDocument();
      expect(screen.getByText("Runs from your watch")).toBeInTheDocument();
    });
  });

  it("hrMethod drives the HR sub-toggle; flipping it writes only hrMethod", async () => {
    const saved: SettingsState[] = [];
    render(<ConnectionsCard
      settings={{ hrMethod: "healthconnect", watchImport: true } as SettingsState}
      saveSettings={s => saved.push(s)} />);
    const hrToggle = await screen.findByRole("switch", { name: "Heart rate after runs" });
    expect(hrToggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(hrToggle);
    await waitFor(() => expect(saved.length).toBe(1));
    expect(saved[0].hrMethod).toBe("off");
    expect(saved[0].watchImport).toBe(true); // untouched
  });

  it("Reconnect that newly grants activity auto-enables watch import", async () => {
    // Connected via HR only (activity was declined before); the reconnect grant
    // now returns activity:true → watchImport should flip on. But an ALREADY-on
    // reconnect must never re-enable a toggle the user deliberately turned off,
    // which applyGrant's newly-granted guard ensures.
    const { healthConnectSource } = await import("../hr/healthconnect");
    const provider = (await import("../imports/providers/healthConnect")).healthConnectProvider;
    (healthConnectSource.checkPermissions as ReturnType<typeof vi.fn>).mockResolvedValue(true); // HR granted
    vi.spyOn(provider, "isConnected").mockResolvedValue(false); // activity NOT granted yet
    (connectHealthConnect as ReturnType<typeof vi.fn>).mockResolvedValue({ availability: "Available", heartRate: true, activity: true });

    const saved: SettingsState[] = [];
    render(<ConnectionsCard
      settings={{ hrMethod: "healthconnect", watchImport: false } as SettingsState}
      saveSettings={s => saved.push(s)} />);
    const reconnect = await screen.findByRole("button", { name: "Reconnect" });
    fireEvent.click(reconnect);
    await waitFor(() => expect(saved.some(s => s.watchImport === true)).toBe(true));
  });
});
