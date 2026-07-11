import { describe, it, expect } from "vitest";
import { parseRunsCsv } from "./csv";

describe("parseRunsCsv — Zepp", () => {
  it("imports a well-formed Zepp row", () => {
    const csv = [
      "Start Time,Distance (m),Duration (s),Average Heart Rate (bpm),Max Heart Rate (bpm)",
      "2026-05-01 08:00:00,5000,1500,150,170",
    ].join("\n");
    const {runs, error} = parseRunsCsv(csv);
    expect(error).toBeNull();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      date: "2026-05-01", km: 5, durationSec: 1500,
      hr: 150, hrMax: 170, elevation: null, notes: "Zepp import",
    });
  });

  it("stamps startedAt from the Zepp start time so imports dedupe by time overlap", () => {
    const csv = [
      "Start Time,Distance (m),Duration (s)",
      "2026-05-01 08:00:00,5000,1500",
    ].join("\n");
    const {runs} = parseRunsCsv(csv);
    expect(runs[0].startedAt).toBe(new Date("2026-05-01T08:00:00").toISOString());
  });

  it("skips rows below the distance/duration thresholds", () => {
    const csv = [
      "Start Time,Distance (m),Duration (s)",
      "2026-05-01 08:00:00,300,40",   // too short / too brief
      "2026-05-02 08:00:00,5000,1500", // valid
    ].join("\n");
    const {runs} = parseRunsCsv(csv);
    expect(runs).toHaveLength(1);
    expect(runs[0].date).toBe("2026-05-02");
  });

  it("skips rows with non-numeric values", () => {
    const csv = [
      "Start Time,Distance (m),Duration (s)",
      "2026-05-01 08:00:00,abc,xyz",
    ].join("\n");
    const {runs, error} = parseRunsCsv(csv);
    expect(runs).toHaveLength(0);
    expect(error).toMatch(/No runs found/);
  });
});

describe("parseRunsCsv — Strava", () => {
  it("imports a Strava row (correctly routed despite the Activity Type column)", () => {
    const csv = [
      "Activity Date,Activity Type,Distance,Elapsed Time,Average Heart Rate,Max Heart Rate,Elevation Gain",
      "2026-05-02,Run,12.5,3600,145,165,120",
    ].join("\n");
    const {runs, error} = parseRunsCsv(csv);
    expect(error).toBeNull();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      km: 12.5, durationSec: 3600, hr: 145, hrMax: 165, elevation: 120, notes: "Strava import",
    });
    expect(runs[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(runs[0].startedAt).toBe(new Date("2026-05-02").toISOString());
  });

  it("ignores non-run activity types", () => {
    const csv = [
      "Activity Date,Activity Type,Distance,Elapsed Time",
      "2026-05-02,Ride,40,3600",
    ].join("\n");
    const {runs} = parseRunsCsv(csv);
    expect(runs).toHaveLength(0);
  });

  it("respects quoted fields containing commas", () => {
    const csv = [
      "Activity Date,Activity Name,Activity Type,Distance,Elapsed Time",
      '2026-05-02,"Morning, run",Run,10,3000',
    ].join("\n");
    const {runs} = parseRunsCsv(csv);
    expect(runs).toHaveLength(1);
    expect(runs[0].km).toBe(10);
    expect(runs[0].durationSec).toBe(3000);
  });
});

describe("parseRunsCsv — invalid input", () => {
  it("reports empty files", () => {
    expect(parseRunsCsv("").error).toBe("Empty file.");
    expect(parseRunsCsv("   ").error).toBe("Empty file.");
  });
  it("reports unrecognised formats", () => {
    const {runs, error} = parseRunsCsv("foo,bar\n1,2");
    expect(runs).toHaveLength(0);
    expect(error).toMatch(/No runs found/);
  });
});
