import { useState } from "react";
import { RefreshCw, Trash2, Copy, EyeOff } from "lucide-react";
import { getTrackLog, clearTrackLog, setGeoDebug, type GeoDiagEvent } from "../geo/trackLog";

// Hidden developer diagnostics for live GPS tracking (revealed together with the
// watch sync log from Settings → Connections by tapping the section title 5×).
// Shows the tracker's raw event stream for recent runs so a screen-off track hole
// can be diagnosed: the summary answers "did fixes keep arriving while the app was
// backgrounded" (the whole question behind the gaps). Raw and English-only — a
// debug surface, not a user feature, so not wired through i18n.

const KIND_CLS: Record<string, string> = {
  "native-fix": "bg-sky-500/15 text-sky-300 border-sky-500/30",
  fix: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  drop: "bg-slate-600/30 text-slate-400 border-slate-500/40",
  gap: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  hidden: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  visible: "bg-emerald-600/15 text-emerald-300 border-emerald-600/30",
  perm: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  error: "bg-rose-600/20 text-rose-300 border-rose-600/40",
  start: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  stop: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  "watch-start": "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  "watch-stop": "bg-slate-600/30 text-slate-400 border-slate-500/40",
};

const clock = (ms: number) => {
  try {
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
  } catch { return String(ms); }
};
const secs = (ms?: number) => (ms == null ? "" : `+${(ms / 1000).toFixed(1)}s`);

// Walk the stream tracking visibility, and measure the largest silence between
// consecutive raw fixes while hidden vs visible — the direct read on whether the
// foreground service keeps feeding fixes with the screen off.
function summarize(events: GeoDiagEvent[]) {
  let visible = true, lastFixT = 0;
  let maxHidden = 0, maxVisible = 0, hiddenFixes = 0, visibleFixes = 0;
  for (const e of events) {
    if (e.kind === "start" || e.kind === "resume") { visible = true; lastFixT = 0; }
    else if (e.kind === "visible") visible = true;
    else if (e.kind === "hidden") visible = false;
    else if (e.kind === "native-fix") {
      const tt = e.t ?? e.at;
      if (lastFixT) {
        const gap = tt - lastFixT;
        if (visible) { if (gap > maxVisible) maxVisible = gap; visibleFixes++; }
        else { if (gap > maxHidden) maxHidden = gap; hiddenFixes++; }
      } else if (visible) visibleFixes++; else hiddenFixes++;
      lastFixT = tt;
    }
  }
  return { maxHidden, maxVisible, hiddenFixes, visibleFixes };
}

function EventRow({ e }: { e: GeoDiagEvent }) {
  const big = (e.kind === "native-fix" || e.kind === "fix" || e.kind === "gap") && (e.sinceMs ?? 0) > 60000;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 border-t border-slate-700/40 text-[11px]">
      <span className="text-slate-500 tabular-nums">{clock(e.t ?? e.at)}</span>
      <span className={`px-1.5 py-0.5 rounded border font-semibold ${KIND_CLS[e.kind] || KIND_CLS.drop}`}>{e.kind}</span>
      {e.msg && <span className="text-slate-300">{e.msg}</span>}
      {e.acc != null && <span className="text-slate-500">±{Math.round(e.acc)}m</span>}
      {e.sinceMs != null && <span className={big ? "text-rose-400 font-semibold" : "text-slate-500"}>{secs(e.sinceMs)}</span>}
      {e.kind === "perm" && <span className={e.ok ? "text-emerald-400" : "text-rose-400"}>{e.ok ? "granted" : "denied"}</span>}
    </div>
  );
}

export function TrackDiagLog({ onHide }: { onHide?: () => void }) {
  const [events, setEvents] = useState<GeoDiagEvent[]>(() => getTrackLog());
  const refresh = () => setEvents(getTrackLog());
  const wipe = () => { clearTrackLog(); refresh(); };
  const copy = () => { try { navigator.clipboard?.writeText(JSON.stringify(events, null, 2)); } catch { /* ignore */ } };
  const hide = () => { setGeoDebug(false); onHide?.(); };

  const s = summarize(events);
  const rows = [...events].reverse(); // newest first

  return (
    <div className="space-y-2 pt-3 mt-1 border-t border-slate-700/60">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex-1">GPS tracking log (dev)</p>
        <button type="button" aria-label="Refresh GPS log" onClick={refresh} className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300"><RefreshCw size={13} /></button>
        <button type="button" aria-label="Copy GPS log as JSON" onClick={copy} className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300"><Copy size={13} /></button>
        <button type="button" aria-label="Clear GPS log" onClick={wipe} className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300"><Trash2 size={13} /></button>
        <button type="button" aria-label="Hide GPS developer log" onClick={hide} className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300"><EyeOff size={13} /></button>
      </div>
      <p className="text-[11px] text-slate-500 -mt-1">
        Fix stream for recent runs. Enabled now — do a run with the screen off, then Refresh. A big
        "max gap while hidden" versus a small "while visible" means fixes stop when the screen is off.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300">
        <span>fixes hidden: <b className="text-amber-300">{s.hiddenFixes}</b> · visible: <b className="text-emerald-300">{s.visibleFixes}</b></span>
        <span>max gap hidden: <b className={s.maxHidden > 60000 ? "text-rose-400" : "text-slate-200"}>{(s.maxHidden / 1000).toFixed(0)}s</b> · visible: <b className="text-slate-200">{(s.maxVisible / 1000).toFixed(0)}s</b></span>
      </div>
      {rows.length === 0
        ? <p className="text-xs text-slate-500 py-2">No events yet. Logging is on — start a run (ideally with the screen off partway), then Refresh.</p>
        : <div className="max-h-96 overflow-y-auto">{rows.map((e, i) => <EventRow key={`${e.at}-${i}`} e={e} />)}</div>}
    </div>
  );
}
