import { useState, useRef, useEffect } from "react";
import { Play, Pause, Square, X, Loader, MapPin, HeartPulse } from "lucide-react";
import { fmt, ymd } from "../utils/format";
import { simplify } from "../utils/geo";
import { saveRoute, queuePendingRoute } from "../routes";
import { useRunTracker } from "../hooks/useRunTracker";
import { getHrSource } from "../hr/source";
import { RouteMap } from "../components/RouteMap";
import { BgLocationDisclosure } from "./BgLocationDisclosure";
import { isNative } from "../native";
import { BG_LOC_DISCLOSED_KEY } from "../constants";

function Stat({ label, value }) {
  return (
    <div className="bg-slate-800 rounded-xl px-3 py-2.5 text-center">
      <p className="text-2xl font-bold text-white leading-tight tabular-nums">{value}</p>
      <p className="text-[11px] text-slate-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}

// Large, glove-friendly control button.
function Ctrl({ onClick, color, children, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={"flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl text-base font-semibold transition-colors disabled:opacity-50 " + color}>
      {children}
    </button>
  );
}

export function LiveRunTracker({ onFinish, onClose, showToast, hrMethod, hrOptOut, onConfigureHr, onDeclineHr }) {
  const t = useRunTracker({ hrMethod });
  const { state, points, stats, error, pending, location } = t;
  const [busy, setBusy] = useState(false);
  // Live HR streams only from a Bluetooth (live) source; Health Connect is fetched
  // post-run in handleSave, so no live tile for it.
  const liveHr = isNative && hrMethod === "bluetooth";
  // Nudge to set up a heart-rate source, shown on run start while HR is off and the
  // user hasn't set it up or expressly declined (settings.hrOptOut). "Not now"
  // dismisses just this run (it returns next run); "Don't record" sets the opt-out.
  // Never blocks Start.
  const [showHrNudge, setShowHrNudge] = useState(
    () => isNative && (hrMethod || "off") === "off" && !hrOptOut);
  const disclosed = () => {
    try { return localStorage.getItem(BG_LOC_DISCLOSED_KEY) === "1"; } catch { return false; }
  };
  const markDisclosed = () => {
    try { localStorage.setItem(BG_LOC_DISCLOSED_KEY, "1"); } catch { /* quota — non-fatal */ }
  };
  // On native, surface the disclosure the moment the tracker opens (not only on
  // Start), so consent is the first thing shown. The flag is set only once the OS
  // grant succeeds (acceptDisclosure), so a denial naturally re-shows the disclosure
  // next time — no need to watch the error text. guardedStart gates Start/Resume too.
  const [showDisclosure, setShowDisclosure] = useState(() => isNative && !disclosed());
  const pendingStartRef = useRef(null); // deferred Start/Resume action, run once consented
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const hasTrack = stats.n > 0;
  const live = state === "tracking" || state === "paused";
  // Run `fn` — which starts a background watch on native — but gate the FIRST one
  // behind the prominent-disclosure (Play requirement). Covers BOTH the idle
  // "Start run" and the paused "Resume" (incl. the crash-recovery resume, which
  // starts a fresh watch), so a background-location request never fires without a
  // prior disclosure. No-op gate on the web / once already disclosed.
  const guardedStart = (fn) => {
    if (isNative && !disclosed()) { pendingStartRef.current = fn; setShowDisclosure(true); }
    else fn();
  };
  const acceptDisclosure = async () => {
    setShowDisclosure(false);
    const run = pendingStartRef.current;
    pendingStartRef.current = null;
    // Ask the OS for location right after consent (native) so the prompt is part of
    // the disclosure flow, not deferred to Start. Mark disclosed only on success, so
    // a denial leaves it unset and the disclosure re-explains next time; the upfront
    // grant also means a later Start won't prompt again.
    const granted = isNative ? await t.requestPermissions() : true;
    if (!granted || !mountedRef.current) return;
    markDisclosed();
    run?.();
  };
  const cancelDisclosure = () => { setShowDisclosure(false); pendingStartRef.current = null; };

  const handleClose = () => {
    if ((live || state === "stopped") && hasTrack &&
      !window.confirm("Discard this run? Your tracked route will be lost.")) return;
    // Only tear down (which clears the crash-recovery buffer) for an in-progress
    // or just-finished run. Backing out while idle must NOT wipe an unresumed
    // recovery buffer — it should still be offered next time the tracker opens.
    if (live || state === "stopped") t.reset();
    onClose();
  };

  const handleSave = async () => {
    setBusy(true);
    const simplified = simplify(points, 5);
    const km = +stats.km.toFixed(2);
    const statObj = { km, durationSec: stats.movingSec, elevation: stats.elevation, avgPace: Math.round(stats.avgPace) };
    const date = ymd(new Date(points.find(Boolean)?.[2] || Date.now()));
    let routeId = null, routeTmp = null;
    try {
      routeId = await saveRoute({ points: simplified, stats: statObj });
    } catch {
      // Offline / save failed — queue the trace so it isn't lost; it relinks on
      // the next load (see flushPendingRoutes in RunningCoach). Don't fail
      // silently: the route is viewable locally but won't be in the cloud yet.
      routeTmp = "rt" + Date.now();
      queuePendingRoute({ tmpId: routeTmp, points: simplified, stats: statObj });
      showToast?.("Couldn't upload the route — saved on this device, will retry syncing.", "err");
    }
    // Heart rate: a live (Bluetooth) source has already filled stats.hrAvg/hrMax.
    // A post-run source (Health Connect) is queried now over the run's time window;
    // if it isn't synced yet, stamp hrPending so RunningCoach relinks on next load.
    let hr = null, hrMax = null, hrPending = null;
    if (stats.hrAvg != null) { hr = stats.hrAvg; hrMax = stats.hrMax; }
    else if (hrMethod === "healthconnect") {
      // Explicit run window from the tracker (robust even with no GPS points),
      // falling back to point timestamps for a recovered run missing startedAt.
      const { startedAt, stoppedAt } = t.runWindow();
      const startMs = startedAt || points.find(Boolean)?.[2] || Date.now();
      let endMs = stoppedAt || Date.now();
      if (!stoppedAt) for (let i = points.length - 1; i >= 0; i--) { if (points[i]) { endMs = points[i][2]; break; } }
      let res = null;
      try { res = await getHrSource("healthconnect")?.fetchRange(startMs, endMs); } catch { /* unsynced — leave null */ }
      if (res && res.hrAvg) { hr = res.hrAvg; hrMax = res.hrMax; }
      else hrPending = { start: startMs, end: endMs, source: "healthconnect" };
    }
    t.finalize();
    setBusy(false);
    onFinish({
      date, type: "EASY", km,
      durationSec: stats.movingSec,
      elevation: stats.elevation || null,
      source: "gps",
      ...(routeId ? { routeId } : {}),
      ...(routeTmp ? { routeTmp, routePending: true } : {}),
      ...(hr != null ? { hr, hrMax } : {}),
      ...(hrPending ? { hrPending } : {}),
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col">
      <header className="flex items-center justify-between px-4 border-b border-slate-800" style={{ height: 44 }}>
        <div className="flex items-center gap-1.5">
          <MapPin size={15} className="text-orange-400" />
          <span className="text-sm font-semibold">{state === "stopped" ? "Run complete" : "Live run"}</span>
        </div>
        <button onClick={handleClose} aria-label="Close"
          className="text-slate-400 hover:text-white p-1.5"><X size={18} /></button>
      </header>

      <div className="flex-1 min-h-0">
        <RouteMap points={points} follow={state === "tracking"} interactive={!live}
          location={location} className="h-full w-full" />
      </div>

      <div className="p-4 space-y-3 border-t border-slate-800">
        {error && <div className="bg-red-500/15 text-red-300 text-sm rounded-xl px-3 py-2">{error}</div>}

        {state === "idle" && pending && (
          <div className="bg-slate-800 rounded-xl p-3 space-y-2 border border-slate-700">
            <p className="text-sm text-slate-200">Resume your previous run?
              <span className="text-slate-400"> {pending.points.filter(Boolean).length} points saved.</span></p>
            <div className="flex gap-2">
              <button onClick={t.resumePrevious}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-lg text-sm font-semibold">Resume</button>
              <button onClick={t.discardPrevious}
                className="px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 py-2 rounded-lg text-sm font-semibold">Discard</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2">
          <Stat label="km" value={stats.km.toFixed(2)} />
          <Stat label="time" value={fmt.dur(stats.movingSec) === "--" ? "0:00" : fmt.dur(stats.movingSec)} />
          <Stat label="pace" value={fmt.pace(state === "tracking" ? stats.curPace : stats.avgPace)} />
          <Stat label="elev" value={stats.elevation + "m"} />
        </div>

        {liveHr && (
          <div className="bg-slate-800 rounded-xl px-3 py-2 flex items-center justify-center gap-2">
            <HeartPulse size={18} className={stats.hr != null ? "text-red-400" : "text-slate-500"} />
            <span className="text-2xl font-bold text-white tabular-nums leading-none">{stats.hr ?? "--"}</span>
            <span className="text-[11px] text-slate-400 uppercase tracking-wide">bpm</span>
            {stats.hrAvg != null
              ? <span className="text-[11px] text-slate-500 ml-2">avg {stats.hrAvg} · max {stats.hrMax}</span>
              : <span className="text-[11px] text-slate-500 ml-2">connecting…</span>}
          </div>
        )}

        {isNative && hrMethod === "healthconnect" && (
          <div className="bg-slate-800 rounded-xl px-3 py-2 flex items-center justify-center gap-2 text-slate-300">
            <HeartPulse size={16} className="text-red-400 shrink-0" />
            <span className="text-xs">Heart rate is added from Health Connect after you finish.</span>
          </div>
        )}

        {state === "idle" && (
          <>
            {location?.acc != null && (
              <p className={"text-[11px] text-center " + (
                location.acc <= 15 ? "text-emerald-400" : location.acc <= 30 ? "text-amber-400" : "text-red-400")}>
                GPS accuracy ±{Math.round(location.acc)} m
                {location.acc <= 15 ? " — good to go" : " — wait for it to settle for a cleaner start"}
              </p>
            )}
            <Ctrl onClick={() => guardedStart(t.start)} color="bg-orange-500 hover:bg-orange-600 text-white">
              <Play size={20} />Start run
            </Ctrl>
          </>
        )}
        {state === "tracking" && (
          <div className="flex gap-2">
            <Ctrl onClick={t.pause} color="bg-slate-700 hover:bg-slate-600 text-slate-100"><Pause size={20} />Pause</Ctrl>
            <Ctrl onClick={t.stop} color="bg-red-500 hover:bg-red-600 text-white"><Square size={18} />Finish</Ctrl>
          </div>
        )}
        {state === "paused" && (
          <div className="flex gap-2">
            <Ctrl onClick={() => guardedStart(t.resume)} color="bg-orange-500 hover:bg-orange-600 text-white"><Play size={20} />Resume</Ctrl>
            <Ctrl onClick={t.stop} color="bg-red-500 hover:bg-red-600 text-white"><Square size={18} />Finish</Ctrl>
          </div>
        )}
        {state === "stopped" && (
          <div className="flex gap-2">
            <Ctrl onClick={handleClose} color="bg-slate-700 hover:bg-slate-600 text-slate-100" disabled={busy}>Discard</Ctrl>
            <Ctrl onClick={handleSave} color="bg-orange-500 hover:bg-orange-600 text-white" disabled={busy}>
              {busy ? <Loader size={18} className="animate-spin" /> : null}Save run
            </Ctrl>
          </div>
        )}

        {live && !isNative && (
          <p className="text-[11px] text-slate-500 text-center leading-snug">
            Keep this screen on while running — browsers can't track in the background, so it
            pauses if the screen locks. A native app version tracks with the screen off (less battery).
          </p>
        )}
      </div>

      {showDisclosure && (
        <BgLocationDisclosure onAccept={acceptDisclosure} onCancel={cancelDisclosure} />
      )}

      {/* Nudge to set up a heart-rate source (shown only when the bg-location
          disclosure isn't up, to avoid stacked sheets). Reappears each run until the
          user sets HR up or taps "Don't record heart rate" (persistent opt-out). */}
      {showHrNudge && !showDisclosure && (
        <div className="fixed inset-0 bg-black/70 z-[2000] flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-sm border border-slate-700 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <HeartPulse size={16} className="text-orange-400" />
              <p className="font-semibold text-sm">Track your heart rate?</p>
            </div>
            <p className="text-sm text-slate-300">
              Connect a Bluetooth sensor or Health Connect to capture heart rate
              automatically — no need to type it in. You can set this up later in Settings.
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button onClick={() => setShowHrNudge(false)}
                className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200">
                Not now
              </button>
              <button onClick={() => { setShowHrNudge(false); onConfigureHr?.(); }}
                className="py-2.5 rounded-xl text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white">
                Set up
              </button>
            </div>
            <button onClick={() => { setShowHrNudge(false); onDeclineHr?.(); }}
              className="w-full text-center text-xs text-slate-500 hover:text-slate-300">
              Don&apos;t record heart rate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
