import { beforeEach, describe, it, expect } from "vitest";
import { GEO_DIAG_LOG_KEY, GEO_DIAG_LOG_MAX, GEO_DEBUG_KEY } from "../constants";
import { logTrack, getTrackLog, clearTrackLog, setGeoDebug, isGeoDebugEnabled } from "./trackLog";

beforeEach(() => { localStorage.clear(); setGeoDebug(false); });

describe("trackLog", () => {
  it("records nothing while disabled (normal runs pay nothing)", () => {
    logTrack("fix", { t: 1 });
    expect(getTrackLog()).toEqual([]);
    expect(isGeoDebugEnabled()).toBe(false);
  });

  it("appends events, newest-last, once enabled", () => {
    setGeoDebug(true);
    logTrack("start", { msg: "native" });
    logTrack("fix", { t: 123, acc: 5, sinceMs: 2000 });
    const log = getTrackLog();
    expect(log).toHaveLength(2);
    expect(log[0].kind).toBe("start");
    expect(log[1]).toMatchObject({ kind: "fix", t: 123, acc: 5, sinceMs: 2000 });
    expect(typeof log[1].at).toBe("number");
  });

  it("caps at GEO_DIAG_LOG_MAX and keeps the newest", () => {
    setGeoDebug(true);
    for (let i = 0; i < GEO_DIAG_LOG_MAX + 50; i++) logTrack("native-fix", { t: i });
    const log = getTrackLog();
    expect(log).toHaveLength(GEO_DIAG_LOG_MAX);
    expect(log[log.length - 1].t).toBe(GEO_DIAG_LOG_MAX + 49); // newest kept
    expect(log[0].t).toBe(50);                                 // oldest 50 dropped
  });

  it("setGeoDebug persists / clears the reveal flag", () => {
    setGeoDebug(true);
    expect(localStorage.getItem(GEO_DEBUG_KEY)).toBe("1");
    setGeoDebug(false);
    expect(localStorage.getItem(GEO_DEBUG_KEY)).toBeNull();
  });

  it("clear empties the log", () => {
    setGeoDebug(true);
    logTrack("fix", {});
    clearTrackLog();
    expect(getTrackLog()).toEqual([]);
  });

  it("tolerates corrupt storage", () => {
    localStorage.setItem(GEO_DIAG_LOG_KEY, "not json");
    expect(getTrackLog()).toEqual([]);
  });
});
