import { useState } from "react";
import { Play, Pause, Square, X, Loader, MapPin } from "lucide-react";
import { fmt, ymd } from "../utils/format";
import { simplify } from "../utils/geo";
import { saveRoute, queuePendingRoute } from "../routes";
import { useRunTracker } from "../hooks/useRunTracker";
import { RouteMap } from "../components/RouteMap";

// Detect the Phase-2 native shell (a TWA/Capacitor build that DOES track in the
// background) so we don't nag those users with the browser-only screen-on notice.
const inNativeShell = typeof window !== "undefined" &&
  (window.__NATIVE_SHELL__ === true || (document.referrer || "").startsWith("android-app://"));

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

export function LiveRunTracker({ onFinish, onClose }) {
  const t = useRunTracker();
  const { state, points, stats, error, pending, location } = t;
  const [busy, setBusy] = useState(false);

  const hasTrack = stats.n > 0;
  const live = state === "tracking" || state === "paused";

  const handleClose = () => {
    if ((live || state === "stopped") && hasTrack &&
      !window.confirm("Discard this run? Your tracked route will be lost.")) return;
    t.reset();
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
      // the next load (see flushPendingRoutes in RunningCoach).
      routeTmp = "rt" + Date.now();
      queuePendingRoute({ tmpId: routeTmp, points: simplified, stats: statObj });
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
          location={state === "idle" ? location : null} className="h-full w-full" />
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

        {state === "idle" && (
          <Ctrl onClick={t.start} color="bg-orange-500 hover:bg-orange-600 text-white">
            <Play size={20} />Start run
          </Ctrl>
        )}
        {state === "tracking" && (
          <div className="flex gap-2">
            <Ctrl onClick={t.pause} color="bg-slate-700 hover:bg-slate-600 text-slate-100"><Pause size={20} />Pause</Ctrl>
            <Ctrl onClick={t.stop} color="bg-red-500 hover:bg-red-600 text-white"><Square size={18} />Finish</Ctrl>
          </div>
        )}
        {state === "paused" && (
          <div className="flex gap-2">
            <Ctrl onClick={t.resume} color="bg-orange-500 hover:bg-orange-600 text-white"><Play size={20} />Resume</Ctrl>
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

        {live && !inNativeShell && (
          <p className="text-[11px] text-slate-500 text-center leading-snug">
            Keep this screen on while running — browsers can't track in the background, so it
            pauses if the screen locks. A native app version tracks with the screen off (less battery).
          </p>
        )}
      </div>
    </div>
  );
}
