import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIVE_RUN_KEY } from "../constants";
import { accuracyOK, distanceKm, elevGainM, haversineM } from "../utils/geo";
import { hrSummary } from "../utils/hr";
import { geoSource } from "../geo/source";
import { getHrSource } from "../hr/source";
import { getPairedDevice } from "../hr/device";
import { isNative } from "../native";

// Live GPS run tracker. All geolocation access is funnelled through this one hook
// so a Phase-2 native shell can swap watchPosition for a background-location
// plugin behind the same interface without touching any UI.
//
// A point is [lat, lng, tEpochMs, altMeters|null]; a `null` entry marks a gap
// where GPS was lost (signal/background) so the route isn't bridged with a
// straight line.

const ACC_MAX_M = 25;        // drop fixes worse than this (tighter = cleaner track)
const ACC_WARMUP_M = 20;     // require a fix at least this good before the FIRST point —
                             // the GNSS chip emits coarse network fixes until satellites lock
const MIN_INTERVAL_MS = 2000; // thin the stream to ~1 point / 2s (battery/storage)
const MIN_HR_PERSIST_MS = 5000; // HR samples land far more often than GPS fixes (~1/s vs
                                 // ~1/2s); persisting the whole recovery buffer on every one
                                 // would make a multi-hour run rewrite it constantly, so a
                                 // sample only triggers a fresh persist at most this often —
                                 // losing a few seconds of HR to a crash is fine.
const MIN_MOVE_M = 5;         // base jitter gate (scaled up for less-accurate fixes below)
const GAP_MS = 60000;         // silence longer than this starts a new segment (gap).
                             // Sized for native background location, which batches
                             // fixes tens of seconds apart — those are real positions,
                             // not lost signal, so we don't break the track over them.
const TICK_MS = 1000;         // UI clock refresh while tracking
const CUR_PACE_WINDOW_MS = 30000; // current-pace look-back
const RESUME_MAX_AGE_MS = 6 * 3600 * 1000; // offer to resume a buffer this fresh

// Permission-denied copy, shared by onErr and requestPermissions so the native
// and web wording can't drift between the two. isNative is fixed at module load.
// Covers both causes ensureForegroundPermission can now fail for — the OS
// permission was declined, OR the device's Location Services are switched off —
// since from here we can't always tell which one it was.
const PERMISSION_DENIED_MSG = isNative
  ? "Location is needed to record your run. Make sure Location is turned on for this device and allow access (“Allow all the time”) for this app, then try again."
  : "Location permission denied. Enable it for this site in your browser settings, then try again.";

const readBuffer = () => {
  try { return JSON.parse(localStorage.getItem(LIVE_RUN_KEY)); }
  catch { return null; }
};
const clearBuffer = () => { try { localStorage.removeItem(LIVE_RUN_KEY); } catch { /* ignore */ } };

// `hrMethod` (settings.hrMethod) selects an optional live heart-rate source. A
// LIVE source (Bluetooth) streams here alongside GPS; a post-run source (Health
// Connect) is handled at save time in LiveRunTracker, not here. Absent/web → no HR.
export function useRunTracker({ hrMethod } = {}) {
  const [state, setState] = useState("idle"); // idle | tracking | paused | stopped
  const [points, setPoints] = useState([]);
  const [hrSamples, setHrSamples] = useState([]); // { bpm, t } from a live HR sensor
  const [error, setError] = useState(null);
  const [movingSec, setMovingSec] = useState(0);
  const [location, setLocation] = useState(null); // preview position shown before recording starts
  // Whether location is usable. On the web the browser handles its own prompt, so
  // the idle preview can always run (true). On native it gates the preview so we
  // never auto-prompt out of context — it flips true once permission is granted
  // (already-granted users via the check below, or via the consent accept flow).
  const [permGranted, setPermGranted] = useState(!isNative);
  // A recoverable in-progress run from a previous session, read once on mount. A
  // buffer older than the cutoff is dropped so a days-old run can't reappear.
  const [pending, setPending] = useState(() => {
    const buf = readBuffer();
    if (buf && buf.points?.length && Date.now() - (buf.savedAt || 0) < RESUME_MAX_AGE_MS) return buf;
    if (buf) clearBuffer();
    return null;
  });

  const stateRef = useRef(state);
  const pointsRef = useRef(points);
  const hrSamplesRef = useRef(hrSamples); // mirror so the async HR callback sees latest
  const lastHrPersistRef = useRef(0); // epoch ms of the last HR-triggered persist (throttle)
  const hrWatchRef = useRef(null);  // live HR source watch handle (null when not streaming)
  const runStartRef = useRef(null); // wall-clock run start (whole run, incl. pauses)
  const runEndRef = useRef(null);   // wall-clock run stop — the Health Connect fetch window
  const accRef = useRef(0);        // completed moving seconds
  const startRef = useRef(null);   // epoch ms the current active segment began
  const watchRef = useRef(null);
  const wakeRef = useRef(null);
  const lastFixRef = useRef(0);    // epoch ms of the last usable fix (incl. ones
                                   // dropped as jitter) — for true gap detection

  // Mirror render state into refs from effects (not during render) so the async
  // geolocation callback always sees the latest values.
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { pointsRef.current = points; }, [points]);
  useEffect(() => { hrSamplesRef.current = hrSamples; }, [hrSamples]);

  const persist = useCallback(() => {
    try {
      localStorage.setItem(LIVE_RUN_KEY, JSON.stringify({
        points: pointsRef.current, accSec: accRef.current, hrSamples: hrSamplesRef.current,
        startAt: startRef.current, startedAt: runStartRef.current, stoppedAt: runEndRef.current,
        state: stateRef.current, savedAt: Date.now(),
      }));
    } catch { /* quota — non-fatal */ }
  }, []);

  // Moving seconds = completed segments + the current live one. Read only from
  // effects/handlers, never during render.
  const computeMoving = useCallback(() => Math.round(
    accRef.current + (stateRef.current === "tracking" && startRef.current ? (Date.now() - startRef.current) / 1000 : 0)
  ), []);

  // ── wake lock ──────────────────────────────────────────────────────────
  const acquireWake = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) wakeRef.current = await navigator.wakeLock.request("screen");
    } catch { /* denied / unsupported — fine */ }
  }, []);
  const releaseWake = useCallback(() => {
    try { wakeRef.current?.release?.(); } catch { /* ignore */ }
    wakeRef.current = null;
  }, []);

  // ── geolocation callback ─────────────────────────────────────────────────
  const onPos = useCallback((pos) => {
    if (stateRef.current !== "tracking") return; // ignore fixes while paused
    if (!accuracyOK(pos, ACC_MAX_M)) return;
    const { latitude, longitude, altitude, accuracy } = pos.coords;
    const t = pos.timestamp || Date.now();
    // Silence since the last usable fix. Measured against every accepted fix
    // (even ones we then drop as jitter), NOT the last stored point, so standing
    // still — which keeps producing fixes — doesn't masquerade as a lost signal.
    const sinceLastFix = lastFixRef.current ? t - lastFixRef.current : 0;
    lastFixRef.current = t;
    const pts = pointsRef.current;
    let last = null;
    for (let i = pts.length - 1; i >= 0; i--) { if (pts[i]) { last = pts[i]; break; } }
    let next = pts;
    if (last) {
      if (t - last[2] < MIN_INTERVAL_MS) return;          // too soon
      // Reject a move smaller than the fix's own uncertainty as jitter, so a
      // less-accurate fix can't zigzag the track or inflate distance. Accurate
      // fixes fall back to the flat MIN_MOVE_M floor.
      const minMove = Math.max(MIN_MOVE_M, (accuracy || 0) * 0.5);
      if (haversineM(last, [latitude, longitude]) < minMove) return; // not moving
      if (sinceLastFix > GAP_MS) next = [...pts, null];   // lost signal → break track
    } else if (accuracy == null || accuracy > ACC_WARMUP_M) {
      // Warm-up: don't anchor the track on a coarse — or unknown-accuracy — pre-lock
      // fix. The web GeolocationPosition always carries a numeric accuracy, so this
      // is unchanged for web; it only tightens the native path, where a plugin fix
      // can report null accuracy (the next fix with a known-good reading anchors).
      return;
    }
    const np = [latitude, longitude, t, altitude == null ? null : Math.round(altitude)];
    pointsRef.current = [...next, np];
    setPoints(pointsRef.current);
    persist();
  }, [persist]);

  // ── live heart-rate callback ─────────────────────────────────────────────
  // Append a sample only while actively tracking (mirrors onPos ignoring fixes
  // when paused) so a paused breather doesn't drag the average down. The state
  // update always happens (so the live BPM tile is current), but persisting the
  // whole recovery buffer is throttled to MIN_HR_PERSIST_MS — a strap notifies
  // at sensor rate (~1/s), and GPS fixes already keep the buffer fresh every
  // ~2s via onPos's own persist() while a run is actually moving.
  const onHrSample = useCallback((sample) => {
    if (stateRef.current !== "tracking") return;
    hrSamplesRef.current = [...hrSamplesRef.current, sample];
    setHrSamples(hrSamplesRef.current);
    const now = Date.now();
    if (now - lastHrPersistRef.current >= MIN_HR_PERSIST_MS) {
      lastHrPersistRef.current = now;
      persist();
    }
  }, [persist]);

  const startHrWatch = useCallback(() => {
    if (hrWatchRef.current) return; // already streaming (e.g. resume)
    const src = getHrSource(hrMethod);
    if (!src || !src.live) return;  // off / web / post-run source → nothing to stream
    const device = getPairedDevice();
    if (!device?.id) return;
    hrWatchRef.current = src.watch(onHrSample, () => { /* non-fatal; run continues */ },
      { deviceId: device?.id });
  }, [hrMethod, onHrSample]);

  const stopHrWatch = useCallback(() => {
    const src = getHrSource(hrMethod);
    if (hrWatchRef.current && src) src.clearWatch(hrWatchRef.current);
    hrWatchRef.current = null;
  }, [hrMethod]);

  const onErr = useCallback((err) => {
    if (err.code === err.PERMISSION_DENIED)
      setError(PERMISSION_DENIED_MSG);
    else if (err.code === err.POSITION_UNAVAILABLE)
      setError("Couldn't get a GPS fix. Make sure location is on and you're outdoors.");
    else if (err.code === err.TIMEOUT)
      setError("GPS is taking too long to respond. Trying again…");
    else setError("Location error: " + err.message);
  }, []);

  const startWatch = useCallback(() => {
    if (!geoSource.isAvailable()) {
      setError("This browser/device doesn't support GPS (geolocation). Geolocation also needs a secure (https) connection.");
      return false;
    }
    // background:true → the native source runs a foreground service so recording
    // continues with the screen off; on web the flag is ignored (no-op).
    watchRef.current = geoSource.watchPosition(onPos, onErr, { background: true });
    return true;
  }, [onPos, onErr]);

  const stopWatch = useCallback(() => {
    if (watchRef.current != null) geoSource.clearWatch(watchRef.current);
    watchRef.current = null;
  }, []);

  // Proactively request the OS location permission (native), so the prompt can be
  // shown as part of the consent flow rather than only when recording starts.
  // Returns whether location is usable; sets an actionable error if denied.
  const requestPermissions = useCallback(async () => {
    try {
      const granted = await geoSource.requestPermissions();
      if (!granted) {
        setError(PERMISSION_DENIED_MSG);
        return false;
      }
      setError(null);
      setPermGranted(true); // unlocks the idle position preview on native
      return true;
    } catch {
      setError("Couldn't request location permission. Please try again.");
      return false;
    }
  }, []);

  // ── controls ─────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    setError(null);
    pointsRef.current = [];
    setPoints([]);
    hrSamplesRef.current = [];
    setHrSamples([]);
    lastHrPersistRef.current = 0;
    accRef.current = 0;
    startRef.current = Date.now();
    runStartRef.current = Date.now();
    runEndRef.current = null;
    lastFixRef.current = 0;
    if (!startWatch()) return;
    stateRef.current = "tracking";
    setState("tracking");
    setMovingSec(0);
    startHrWatch();
    acquireWake();
    persist();
  }, [startWatch, startHrWatch, acquireWake, persist]);

  const pause = useCallback(() => {
    if (stateRef.current !== "tracking") return;
    if (startRef.current) accRef.current += (Date.now() - startRef.current) / 1000;
    startRef.current = null;
    stateRef.current = "paused";
    setState("paused");
    setMovingSec(computeMoving());
    releaseWake();
    persist();
  }, [releaseWake, persist, computeMoving]);

  const resume = useCallback(() => {
    if (stateRef.current !== "paused") return;
    startRef.current = Date.now();
    if (watchRef.current == null) startWatch();
    stateRef.current = "tracking";
    setState("tracking");
    startHrWatch();
    acquireWake();
    persist();
  }, [startWatch, startHrWatch, acquireWake, persist]);

  const stop = useCallback(() => {
    if (stateRef.current === "tracking" && startRef.current)
      accRef.current += (Date.now() - startRef.current) / 1000;
    startRef.current = null;
    runEndRef.current = Date.now();
    stopWatch();
    stopHrWatch();
    releaseWake();
    stateRef.current = "stopped";
    setState("stopped");
    setMovingSec(computeMoving());
    persist();
  }, [stopWatch, stopHrWatch, releaseWake, persist, computeMoving]);

  const reset = useCallback(() => {
    stopWatch();
    stopHrWatch();
    releaseWake();
    pointsRef.current = [];
    setPoints([]);
    hrSamplesRef.current = [];
    setHrSamples([]);
    lastHrPersistRef.current = 0;
    accRef.current = 0;
    startRef.current = null;
    runStartRef.current = null;
    runEndRef.current = null;
    lastFixRef.current = 0;
    setError(null);
    setMovingSec(0);
    stateRef.current = "idle";
    setState("idle");
    clearBuffer();
  }, [stopWatch, stopHrWatch, releaseWake]);

  // Load a recoverable buffer into an active (paused) session.
  const resumePrevious = useCallback(() => {
    setPending(prev => {
      const buf = prev;
      if (!buf) return prev;
      // Break the track between the recovered points and whatever gets recorded
      // next: an unknown amount of time may have passed since the crash, so the
      // join is a gap (drawn dashed, not a solid recorded line). Note distanceKm
      // still bridges it with the straight-line minimum — fine for an in-run
      // crash, but if the runner travelled by other means before resuming that
      // leg will be counted; the runner can edit the saved distance if so.
      const recovered = buf.points || [];
      if (recovered.length && recovered[recovered.length - 1] != null) recovered.push(null);
      pointsRef.current = recovered;
      setPoints(pointsRef.current);
      hrSamplesRef.current = buf.hrSamples || [];
      setHrSamples(hrSamplesRef.current);
      accRef.current = buf.accSec || 0;
      runStartRef.current = buf.startedAt || null; // preserve the run window across a crash
      runEndRef.current = null;
      startRef.current = null;
      lastFixRef.current = 0;
      setError(null);
      setMovingSec(Math.round(buf.accSec || 0));
      stateRef.current = "paused"; // user taps Resume to continue recording
      setState("paused");
      return null;
    });
  }, []);

  const discardPrevious = useCallback(() => {
    clearBuffer();
    setPending(null);
  }, []);

  const finalize = clearBuffer; // call after a successful save

  // ── effects ──────────────────────────────────────────────────────────────
  // UI clock while actively tracking.
  useEffect(() => {
    if (state !== "tracking") return;
    const id = setInterval(() => setMovingSec(computeMoving()), TICK_MS);
    return () => clearInterval(id);
  }, [state, computeMoving]);

  // Re-acquire the wake lock when returning to the foreground (it auto-releases
  // when the page hides) and flush the buffer on hide.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        if (stateRef.current === "tracking") acquireWake();
      } else {
        persist();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [acquireWake, persist]);

  // Tear down on unmount.
  useEffect(() => () => { stopWatch(); stopHrWatch(); releaseWake(); }, [stopWatch, stopHrWatch, releaseWake]);

  // Native, returning user: location may already be granted from a prior session.
  // Check WITHOUT prompting so the idle preview can show straight away (the lazy
  // initial state covers the web, which is always true).
  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    geoSource.checkPermissions()
      .then(ok => { if (!cancelled && ok) setPermGranted(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Live preview fix while idle so the user can see their position AND its
  // accuracy (the map draws a circle around it) and calibrate before hitting
  // Start. Runs only in idle; the cleanup stops it the moment recording begins,
  // and the last value persists so the map stays pinned through the transition.
  // Silent on error — recording's own watch surfaces permission issues.
  useEffect(() => {
    if (state !== "idle") return;
    if (!geoSource.isAvailable()) return;
    // On native, only after permission is granted — never auto-prompt out of
    // context before the disclosure. Once granted (returning user, or via the
    // consent accept), the preview shows the current position + accuracy just like
    // the web build. The web is always permitted (permGranted starts true).
    if (!permGranted) return;
    // Foreground-only preview (background:false) — no foreground service /
    // notification while the user is still on the start screen.
    const handle = geoSource.watchPosition(
      pos => setLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        acc: pos.coords.accuracy ?? null,
      }),
      () => {},
      { background: false },
    );
    return () => geoSource.clearWatch(handle);
  }, [state, permGranted]);

  // ── derived stats ──────────────────────────────────────────────────────────
  // Split from the HR summary on purpose: a live HR sensor notifies at ~1 Hz,
  // far more often than GPS fixes land, so keying one memo on both `points` and
  // `hrSamples` would re-run the O(points) distance/elevation/pace scan below on
  // every heart-rate sample instead of only when the track actually changes.
  const gpsStats = useMemo(() => {
    const km = distanceKm(points);
    const elevation = Math.round(elevGainM(points));
    const avgPace = km > 0 ? movingSec / km : 0;
    // Current pace over the last window, anchored on the latest fix's time.
    let curPace = 0;
    if (points.length >= 2) {
      const lastT = points[points.length - 1]?.[2];
      if (lastT) {
        const win = points.filter(p => p && p[2] >= lastT - CUR_PACE_WINDOW_MS);
        if (win.length >= 2) {
          const d = distanceKm(win);
          const dt = (win[win.length - 1][2] - win[0][2]) / 1000;
          if (d > 0 && dt > 0) curPace = dt / d;
        }
      }
    }
    return { km, elevation, movingSec, avgPace, curPace, n: points.filter(Boolean).length };
  }, [points, movingSec]);

  const stats = useMemo(() => ({ ...gpsStats, ...hrSummary(hrSamples) }), [gpsStats, hrSamples]);

  return {
    state, points, stats, error, pending, location,
    // Wall-clock run window, read on demand from an event handler (never during
    // render) — used by handleSave to scope the Health Connect HR fetch.
    runWindow: () => ({ startedAt: runStartRef.current, stoppedAt: runEndRef.current }),
    start, pause, resume, stop, reset, requestPermissions,
    resumePrevious, discardPrevious, finalize,
  };
}
