import { useState, useRef, useEffect } from "react";
import { Play, Pause, Square, X, Loader, MapPin, HeartPulse } from "lucide-react";
import { fmt, ymd } from "../utils/format";
import { simplify } from "../utils/geo";
import { saveRoute, queuePendingRoute } from "../routes";
import { useRunTracker } from "../hooks/useRunTracker";
import { getHrSource } from "../hr/source";
import { getPairedDevice } from "../hr/device";
import { hasHealthConnectAuthorization } from "../hr/healthconnect";
import { RouteMap } from "../components/RouteMap";
import { ModalOverlay, ConfirmButtons } from "../components/ModalPrimitives";
import { BetaBadge } from "../components/BetaBadge";
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
  const pairedHrDevice = getPairedDevice();
  const healthConnectAuthorized = hasHealthConnectAuthorization();
  const hrReady = !isNative
    || (hrMethod || "off") === "off"
    || (hrMethod === "bluetooth" && !!pairedHrDevice)
    || (hrMethod === "healthconnect" && healthConnectAuthorized);
  const effectiveHrMethod = hrReady ? hrMethod : "off";
  const t = useRunTracker({ hrMethod: effectiveHrMethod });
  const { state, points, stats, error, pending, location } = t;
  const [busy, setBusy] = useState(false);
  // Resolve the HR source once per render from the seam (source.js), instead of
  // matching method-id strings all over this file — null off web/"off"/unknown,
  // otherwise carries the `live` flag every branch below dispatches on.
  const hrSrc = getHrSource(effectiveHrMethod);
  // Live HR streams only from a `live` (Bluetooth) source; a post-run source
  // (Health Connect) is fetched in handleSave instead, so no live tile for it.
  const liveHr = !!hrSrc?.live;
  // Nudge to set up / re-authorize a heart-rate source, offered when the user taps
  // Start while HR is off or the synced method is not ready on this device. "Not
  // now" dismisses just this run; "Don't record" sets the opt-out only for the
  // generic off-state prompt. Never blocks Start — see guardedStart/maybeShowHrNudge.
  const [showHrNudge, setShowHrNudge] = useState(false);
  const hrNudge = (() => {
    if (!isNative) return null;
    if (hrMethod === "healthconnect" && !healthConnectAuthorized) return {
      title: "Authorize Health Connect?",
      body: "Health Connect is selected, but this phone has not granted access yet. Authorize it in Settings to add heart rate after runs.",
      acceptLabel: "Open Settings",
      allowOptOut: false,
    };
    if (hrMethod === "bluetooth" && !pairedHrDevice) return {
      title: "Pair your heart-rate sensor?",
      body: "Bluetooth heart-rate capture is selected, but no sensor is paired on this phone. Pair one in Settings to record live BPM.",
      acceptLabel: "Pair sensor",
      allowOptOut: false,
    };
    if ((hrMethod || "off") === "off" && !hrOptOut) return {
      title: "Track your heart rate?",
      body: "Connect a Bluetooth sensor or Health Connect to capture heart rate automatically — no need to type it in. You can set this up later in Settings.",
      acceptLabel: "Set up",
      allowOptOut: true,
    };
    return null;
  })();
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
  const pendingStartRef = useRef(null); // deferred Start/Resume action, run once consented/nudged
  const pendingHrCheckRef = useRef(false); // whether that deferred action should also offer the HR nudge
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const hasTrack = stats.n > 0;
  const live = state === "tracking" || state === "paused";
  // Offer the HR nudge in place of `fn`, deferring it the same way the
  // disclosure does. Returns whether the nudge took over (caller must not also
  // call fn in that case).
  const maybeShowHrNudge = (fn) => {
    if (hrNudge) {
      pendingStartRef.current = fn;
      setShowHrNudge(true);
      return true;
    }
    return false;
  };
  // Run `fn` — which starts a background watch on native — but gate the FIRST one
  // behind the prominent-disclosure (Play requirement) and, only for a genuine
  // run start (checkHr), the HR setup nudge — never on Resume, so pausing for a
  // traffic light doesn't re-nag. Covers BOTH the idle "Start run" and the paused
  // "Resume" (incl. the crash-recovery resume, which starts a fresh watch), so a
  // background-location request never fires without a prior disclosure. No-op
  // gate on the web / once already disclosed.
  const guardedStart = (fn, checkHr = false) => {
    if (isNative && !disclosed()) {
      pendingStartRef.current = fn;
      pendingHrCheckRef.current = checkHr;
      setShowDisclosure(true);
      return;
    }
    if (checkHr && maybeShowHrNudge(fn)) return;
    fn();
  };
  const acceptDisclosure = async () => {
    setShowDisclosure(false);
    const run = pendingStartRef.current;
    const checkHr = pendingHrCheckRef.current;
    pendingStartRef.current = null;
    pendingHrCheckRef.current = false;
    // Ask the OS for location right after consent (native) so the prompt is part of
    // the disclosure flow, not deferred to Start. Mark disclosed only on success, so
    // a denial leaves it unset and the disclosure re-explains next time; the upfront
    // grant also means a later Start won't prompt again.
    const granted = isNative ? await t.requestPermissions() : true;
    if (!granted || !mountedRef.current) return;
    markDisclosed();
    if (checkHr && maybeShowHrNudge(run)) return;
    run?.();
  };
  const cancelDisclosure = () => {
    setShowDisclosure(false);
    pendingStartRef.current = null;
    pendingHrCheckRef.current = false;
  };
  // "Not now"/"Don't record" both let the deferred Start/Resume proceed (the
  // nudge never blocks Start); "Set up" hands off to Settings instead.
  const dismissHrNudge = (run) => {
    setShowHrNudge(false);
    const fn = pendingStartRef.current;
    pendingStartRef.current = null;
    if (run) fn?.();
  };

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
    // Heart rate: a live source (hrSrc.live, e.g. Bluetooth) has already filled
    // stats.hrAvg/hrMax. A post-run source (hrSrc set, not live, e.g. Health
    // Connect) is queried now over the run's time window; if it isn't synced yet,
    // stamp hrPending so RunningCoach relinks on next load. Branching on hrSrc
    // (not a hard-coded method id) means a future post-run source needs no edits
    // here — and hrSrc is already null on web or when the synced method is not
    // ready on this device, so this can't fire without local authorization/pairing.
    let hr = null, hrMax = null, hrPending = null;
    if (stats.hrAvg != null) { hr = stats.hrAvg; hrMax = stats.hrMax; }
    else if (hrSrc && !hrSrc.live) {
      // Explicit run window from the tracker (robust even with no GPS points),
      // falling back to point timestamps for a recovered run missing startedAt.
      const { startedAt, stoppedAt } = t.runWindow();
      const startMs = startedAt || points.find(Boolean)?.[2] || Date.now();
      let endMs = stoppedAt || Date.now();
      if (!stoppedAt) for (let i = points.length - 1; i >= 0; i--) { if (points[i]) { endMs = points[i][2]; break; } }
      let res = null;
      try { res = await hrSrc.fetchRange(startMs, endMs); } catch { /* unsynced — leave null */ }
      if (res && res.hrAvg) { hr = res.hrAvg; hrMax = res.hrMax; }
      else hrPending = { start: startMs, end: endMs, source: hrSrc.id };
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
            <BetaBadge />
            {stats.hrAvg != null
              ? <span className="text-[11px] text-slate-500 ml-2">avg {stats.hrAvg} · max {stats.hrMax}</span>
              : <span className="text-[11px] text-slate-500 ml-2">connecting…</span>}
          </div>
        )}

        {hrSrc && !hrSrc.live && (
          <div className="bg-slate-800 rounded-xl px-3 py-2 flex items-center justify-center gap-2 text-slate-300">
            <HeartPulse size={16} className="text-red-400 shrink-0" />
            <BetaBadge />
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
            <Ctrl onClick={() => guardedStart(t.start, true)} color="bg-orange-500 hover:bg-orange-600 text-white">
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

      {/* Nudge to set up a heart-rate source, offered once per Start tap (never on
          Resume/pause cycles) while the location disclosure isn't up — see
          guardedStart/maybeShowHrNudge. Reappears each run until the user sets HR
          up or taps "Don't record heart rate" (persistent opt-out). */}
      {showHrNudge && (
        <ModalOverlay>
          <div className="bg-slate-800 rounded-2xl w-full max-w-sm border border-slate-700 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <HeartPulse size={16} className="text-orange-400" />
              <p className="font-semibold text-sm">{hrNudge?.title || "Track your heart rate?"}</p>
              <BetaBadge label="New beta" />
            </div>
            <p className="text-sm text-slate-300">
              {hrNudge?.body || "Connect a Bluetooth sensor or Health Connect to capture heart rate automatically — no need to type it in. You can set this up later in Settings."}
            </p>
            <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-100">
              This capture feature is new and can break. Please check saved readings
              before using them for training decisions.
            </p>
            <ConfirmButtons cancelLabel="Not now" acceptLabel={hrNudge?.acceptLabel || "Set up"}
              onCancel={() => dismissHrNudge(true)}
              onAccept={() => { dismissHrNudge(false); onConfigureHr?.(); }} />
            {hrNudge?.allowOptOut && (
              <button onClick={() => { dismissHrNudge(true); onDeclineHr?.(); }}
                className="w-full text-center text-xs text-slate-500 hover:text-slate-300">
                Don&apos;t record heart rate
              </button>
            )}
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
