import { describe, it, expect } from "vitest";
import { hrZoneBpm, sessionHR, runZoneIndex, parseHrMeasurement, hrSummary, HR_ZONES, SESSION_ZONES } from "./hr";

type HrSample = { bpm: number; t: number };

const summarize = hrSummary as (samples?: HrSample[]) => { hr: number | null; hrAvg: number | null; hrMax: number | null };

// Build a DataView the way Web Bluetooth / the BLE plugin deliver a characteristic.
const dv = (bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);

describe("hrZoneBpm", () => {
  it("computes Karvonen (heart-rate reserve) ranges", () => {
    // HRR = 200 - 60 = 140; lo = 140*0.5 + 60, hi = 140*0.6 + 60
    expect(hrZoneBpm(0.5, 0.6, 200, 60)).toEqual({lo: 130, hi: 144});
  });
  it("returns null without a max HR", () => {
    expect(hrZoneBpm(0.5, 0.6, 0, 60)).toBeNull();
  });
  it("returns null when heart-rate reserve is non-positive", () => {
    expect(hrZoneBpm(0.5, 0.6, 60, 60)).toBeNull();
  });
});

describe("sessionHR", () => {
  const settings = {maxHR: 200, restHR: 60};

  it("maps EASY to its Z2 range", () => {
    const r = sessionHR("EASY", settings);
    expect(r).toMatchObject({lo: 144, hi: 158, label: SESSION_ZONES.EASY.label});
  });
  it("spans multiple zones for TEMPO (Z3-4)", () => {
    const r = sessionHR("TEMPO", settings)!;
    // lo from zone 3 (0.70), hi from zone 4 (0.90)
    expect(r.lo).toBe(158);
    expect(r.hi).toBe(186);
  });
  it("falls back to EASY for unknown types", () => {
    expect(sessionHR("MYSTERY", settings)).toEqual(sessionHR("EASY", settings));
  });
  it("returns null without a max HR", () => {
    expect(sessionHR("EASY", {maxHR: 0, restHR: 60})).toBeNull();
  });
});

describe("runZoneIndex", () => {
  // Karvonen on maxHR 200 / restHR 60 (HRR 140): Z1 130-144, Z2 144-158,
  // Z3 158-172, Z4 172-186, Z5 186+.
  it("classifies an HR into its Karvonen zone", () => {
    expect(runZoneIndex(150, 200, 60)).toBe(2);
    expect(runZoneIndex(180, 200, 60)).toBe(4);
  });
  it("treats the top zone as open-ended", () => {
    expect(runZoneIndex(210, 200, 60)).toBe(5);
  });
  it("returns null without an HR or max HR", () => {
    expect(runZoneIndex(0, 200, 60)).toBeNull();
    expect(runZoneIndex(150, 0, 60)).toBeNull();
  });
});

describe("parseHrMeasurement", () => {
  it("parses an 8-bit bpm (flags bit0 = 0)", () => {
    // flags 0x00, bpm 0x91 = 145
    expect(parseHrMeasurement(dv([0x00, 0x91]))).toEqual({ bpm: 145, rr: [] });
  });
  it("parses a 16-bit bpm (flags bit0 = 1, little-endian)", () => {
    // flags 0x01, bpm 0x012C = 300
    expect(parseHrMeasurement(dv([0x01, 0x2c, 0x01]))).toEqual({ bpm: 300, rr: [] });
  });
  it("skips energy-expended and reads trailing R-R intervals", () => {
    // flags 0x18 (energy bit3 + RR bit4), bpm 150, energy 0x0000, RR 0x0300 = 768/1024 s
    expect(parseHrMeasurement(dv([0x18, 0x96, 0x00, 0x00, 0x00, 0x03]))).toEqual({ bpm: 150, rr: [750] });
  });
  it("reads multiple R-R intervals", () => {
    // flags 0x10 (RR only), bpm 150, RR 0x0300 (750ms) then 0x0200 (500ms)
    expect(parseHrMeasurement(dv([0x10, 0x96, 0x00, 0x03, 0x00, 0x02]))!.rr).toEqual([750, 500]);
  });
  it("tolerates flags declaring fields that aren't present", () => {
    // flags 0x10 (RR bit set) but no trailing RR bytes → bpm parsed, rr empty
    expect(parseHrMeasurement(dv([0x10, 0x96]))).toEqual({ bpm: 150, rr: [] });
    // sensor-contact bits (0x06) set alongside an 8-bit bpm — must not shift parsing
    expect(parseHrMeasurement(dv([0x06, 0x91]))).toEqual({ bpm: 145, rr: [] });
  });
  it("returns null for missing, empty, too-short, or zero-bpm data", () => {
    expect(parseHrMeasurement(null)).toBeNull();
    expect(parseHrMeasurement(dv([]))).toBeNull();
    expect(parseHrMeasurement(dv([0x00]))).toBeNull(); // flags but no value
    expect(parseHrMeasurement(dv([0x01, 0x2c]))).toBeNull(); // 16-bit flag but truncated value
    expect(parseHrMeasurement(dv([0x00, 0x00]))).toBeNull(); // 0 bpm = no contact
  });
});

describe("hrSummary", () => {
  it("reduces samples to latest / average / max", () => {
    const samples = [{ bpm: 120, t: 1 }, { bpm: 150, t: 2 }, { bpm: 140, t: 3 }];
    expect(hrSummary(samples)).toEqual({ hr: 140, hrAvg: 137, hrMax: 150 });
  });
  it("returns nulls for an empty/absent stream", () => {
    expect(hrSummary([])).toEqual({ hr: null, hrAvg: null, hrMax: null });
    expect(summarize(undefined)).toEqual({ hr: null, hrAvg: null, hrMax: null });
  });
});

describe("HR_ZONES", () => {
  it("defines five contiguous zones", () => {
    expect(HR_ZONES).toHaveLength(5);
    expect(HR_ZONES.map(z => z.n)).toEqual([1, 2, 3, 4, 5]);
  });
});
