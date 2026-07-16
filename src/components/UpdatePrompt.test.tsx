import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PLAY_STORE_URL } from "../constants";

// Mutable platform flags so one file can exercise both shells; the component
// reads the imported bindings at call time, so getters stay live per-test.
const platform = { isAndroid: false, isIos: false };
vi.mock("../native", () => ({
  get isAndroid() { return platform.isAndroid; },
  get isIos() { return platform.isIos; },
}));

const { browserOpen } = vi.hoisted(() => ({ browserOpen: vi.fn() }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: browserOpen } }));

import { UpdateBanner, UpdateRequired } from "./UpdatePrompt";

// Stub window.location.assign and return the spy. jsdom's Location props are
// prototype accessors, so the spread copies little — restoreAllMocks below
// puts the real location back before each test so the stub can't leak.
function mockLocationAssign() {
  const assign = vi.fn();
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign } as unknown as Location);
  return assign;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  browserOpen.mockResolvedValue(undefined);
  platform.isAndroid = false;
  platform.isIos = false;
});

describe("UpdateBanner", () => {
  it("Android: opens the Play Store via plain navigation, never @capacitor/browser", async () => {
    // Regression: routing the store link through @capacitor/browser (Chrome
    // Custom Tabs) crashed the app on-device. Android must use a top-frame
    // navigation, which Capacitor hands to the OS as an ACTION_VIEW intent.
    platform.isAndroid = true;
    const assign = mockLocationAssign();

    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(PLAY_STORE_URL));
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it("non-Android: opens the store via the Browser plugin", async () => {
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(browserOpen).toHaveBeenCalledWith({ url: PLAY_STORE_URL }));
  });

  it("iOS: hides the store button while APP_STORE_URL is unset", () => {
    platform.isIos = true;
    render(<UpdateBanner />);
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    // The copy (and the dismiss control) still tell the user to update.
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("dismisses", () => {
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("A new version of Running Coach is available.")).toBeNull();
  });
});

describe("UpdateRequired", () => {
  it("Android: the hard gate's button also uses plain navigation", async () => {
    platform.isAndroid = true;
    const assign = mockLocationAssign();

    render(<UpdateRequired />);
    fireEvent.click(screen.getByRole("button", { name: "Update now" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(PLAY_STORE_URL));
    expect(browserOpen).not.toHaveBeenCalled();
  });
});
