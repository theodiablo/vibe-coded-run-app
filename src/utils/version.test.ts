import { describe, it, expect } from "vitest";
import { compareVersions, versionStatus } from "./version";

describe("compareVersions", () => {
  it("orders by numeric segments (not lexically)", () => {
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1); // 2 < 10, not "2" > "1"
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  });
  it("treats missing trailing segments as 0", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBe(1);
  });
  it("ignores pre-release suffixes", () => {
    expect(compareVersions("1.2.0-beta", "1.2.0")).toBe(0);
  });
});

describe("versionStatus", () => {
  const cfg = { min_supported_version: "1.0.0", latest_version: "1.5.0" };
  it("never blocks when version or config is unknown (e.g. web)", () => {
    expect(versionStatus(null, cfg)).toBe("ok");
    expect(versionStatus("1.5.0", null)).toBe("ok");
  });
  it("forces an update below the supported floor", () => {
    expect(versionStatus("0.9.0", cfg)).toBe("must-update");
  });
  it("nudges between the floor and latest", () => {
    expect(versionStatus("1.2.0", cfg)).toBe("update-available");
  });
  it("is ok at or above latest", () => {
    expect(versionStatus("1.5.0", cfg)).toBe("ok");
    expect(versionStatus("1.6.0", cfg)).toBe("ok");
  });
});
