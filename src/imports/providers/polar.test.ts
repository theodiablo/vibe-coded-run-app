import { describe, it, expect } from "vitest";
import { polarExerciseToRun } from "./polar";

// A tiny GPX with HR extensions (≈1.11 km north, 10 min), same shape as gpx.test.
const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><trkseg>
    <trkpt lat="45.000" lon="5.000"><ele>200</ele><time>2026-07-10T08:00:00Z</time>
      <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="45.010" lon="5.000"><ele>210</ele><time>2026-07-10T08:10:00Z</time>
      <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>160</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
  </trkseg></trk>
</gpx>`;

describe("polarExerciseToRun", () => {
  it("imports a summary-only run (no GPX): distance, ISO duration, HR, extId", () => {
    const run = polarExerciseToRun({
      id: "abc",
      summary: {
        id: "abc",
        "start-time": "2026-07-10T08:00:00",
        duration: "PT1H2M3S",
        distance: 12000,
        "heart-rate": { average: 152.4, maximum: 178 },
        "detailed-sport-info": "RUNNING",
      },
    });
    expect(run).toMatchObject({
      date: "2026-07-10",
      type: "EASY",
      km: 12,
      durationSec: 3723,        // 1h2m3s
      hr: 152,
      hrMax: 178,
      source: "watch",
      notes: "Imported from Polar",
      extId: "polar:abc",
      startedAt: "2026-07-10T08:00:00",
    });
    expect(run!.points).toBeUndefined(); // summary-only → no route
  });

  it("maps a walking sport to WALK", () => {
    const run = polarExerciseToRun({
      id: "w1",
      summary: { id: "w1", "start-time": "2026-07-10T08:00:00", duration: "PT30M", distance: 3000, sport: "WALKING" },
    });
    expect(run?.type).toBe("WALK");
  });

  it("skips a non-run sport (cycling)", () => {
    expect(polarExerciseToRun({
      id: "c1",
      summary: { id: "c1", "start-time": "2026-07-10T08:00:00", duration: "PT1H", distance: 30000, sport: "CYCLING" },
    })).toBeNull();
  });

  it("uses the GPX route (points + raw HR series) and restamps Polar provenance", () => {
    const run = polarExerciseToRun({
      id: "g1",
      summary: { id: "g1", "start-time": "2026-07-10T08:00:00", "detailed-sport-info": "TRAIL_RUNNING" },
      gpx: GPX,
    });
    expect(run).toBeTruthy();
    expect(run!.points).toHaveLength(2);
    expect(run!.hrSamples).toEqual([
      { bpm: 140, t: Date.parse("2026-07-10T08:00:00Z") },
      { bpm: 160, t: Date.parse("2026-07-10T08:10:00Z") },
    ]);
    expect(run).toMatchObject({ type: "EASY", source: "watch", notes: "Imported from Polar", extId: "polar:g1" });
  });

  it("returns null when there is neither a route nor a usable distance", () => {
    expect(polarExerciseToRun({
      id: "z1",
      summary: { id: "z1", "start-time": "2026-07-10T08:00:00", duration: "PT10M", distance: 0, sport: "RUNNING" },
    })).toBeNull();
  });
});
