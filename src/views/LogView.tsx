import { useState, useRef, type ChangeEvent } from "react";
import { Loader, Plus, Upload, MapPin, HeartPulse } from "lucide-react";
import { INPUT_CLS, LABEL_CLS } from "../constants";
import { ymd } from "../utils/format";
import { parseRunsCsv, MAX_CSV_BYTES } from "../utils/csv";
import type { HrPending, Run } from "../types";

type LogForm = {
  date: string;
  type: string;
  km: string;
  dH: string;
  dM: string;
  dS: string;
  hr: string;
  hrMax: string;
  elev: string;
  effort: number | string;
  notes: string;
};

type LogPrefill = Partial<Run> & {
  pace?: number;
  wNum?: number;
  sId?: string;
  hrPending?: HrPending | null;
};

type LogViewProps = {
  addRuns: (runs: Partial<Run>[]) => void;
  onDone: () => void;
  onSaved?: () => void;
  prefill?: LogPrefill | null;
  openTracker?: () => void;
};

export function LogView({addRuns, onDone, onSaved, prefill, openTracker}: LogViewProps) {
  // A GPS-tracked run prefills its real measured duration; a plan session
  // prefills an estimate from km × prescribed pace.
  const estSec = prefill?.durationSec != null
    ? prefill.durationSec
    : (prefill?.km && prefill?.pace ? Math.round(prefill.km * prefill.pace) : 0);
  const INIT = {
    date:   prefill?.date || ymd(new Date()),
    type:   prefill?.type || "EASY",
    km:     prefill?.km != null ? String(prefill.km) : "",
    dH:     estSec >= 3600 ? String(Math.floor(estSec / 3600)) : "",
    dM:     estSec >= 60   ? String(Math.floor((estSec % 3600) / 60)) : "",
    dS:     Math.round(estSec % 60) ? String(Math.round(estSec % 60)) : "",
    hr:    prefill?.hr    != null ? String(prefill.hr)    : "",
    hrMax: prefill?.hrMax != null ? String(prefill.hrMax) : "",
    elev: prefill?.elevation != null ? String(prefill.elevation) : "",effort:5,notes:"",
  };
  const [f,      setF]    = useState<LogForm>(INIT);
  const [busy,   setBusy] = useState(false);
  const [showImp,setImp]  = useState(false);
  const [csvMsg, setCsvMsg] = useState("");
  const fRef = useRef<HTMLInputElement | null>(null);
  const set  = (k: keyof LogForm, v: string | number) => setF(prev => ({...prev, [k]: v}));

  const showMsg = (msg: string, ms?: number) => { setCsvMsg(msg); setTimeout(() => setCsvMsg(""), ms || 3000); };

  const submit = async () => {
    if (!f.km || (!f.dM && !f.dH)) { showMsg("Distance and duration are required."); return; }
    setBusy(true);
    const sec = (parseInt(f.dH)||0)*3600 + (parseInt(f.dM)||0)*60 + (parseInt(f.dS)||0);
    addRuns([{
      date: f.date, type: f.type, km: parseFloat(f.km), durationSec: sec,
      hr:        f.hr    ? parseInt(f.hr, 10)    : null,
      hrMax:     f.hrMax ? parseInt(f.hrMax, 10) : null,
      elevation: f.elev  ? parseInt(f.elev, 10)  : undefined,
      effort:    parseInt(String(f.effort), 10), notes: f.notes,
      // Carry the GPS trace reference through from a live-tracked run.
      ...(prefill?.source   ? { source: prefill.source } : {}),
      ...(prefill?.routeId  ? { routeId: prefill.routeId } : {}),
      ...(prefill?.routeTmp ? { routeTmp: prefill.routeTmp, routePending: true } : {}),
      // Health Connect HR wasn't ready at save — relink on next load (RunningCoach).
      ...(prefill?.hrPending ? { hrPending: prefill.hrPending } : {}),
    }]);
    setBusy(false); onSaved?.(); onDone();
  };

  const handleCSV = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = "";
    if (file.size > MAX_CSV_BYTES) {
      showMsg("File too large — max 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showMsg("Couldn't read that file.");
    reader.onload = ev => {
      const {runs, error} = parseRunsCsv(String(ev.target?.result || ""));
      if (runs.length) {
        addRuns(runs);
        showMsg("Imported " + runs.length + " run" + (runs.length > 1 ? "s" : "") + ".");
        setTimeout(() => onDone(), 1500);
      } else {
        showMsg(error || "No runs found. Check it's a Zepp or Strava CSV.");
      }
    };
    reader.readAsText(file);
  };

  const impBtnCls = "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors " +
    (showImp ? "bg-orange-500 border-orange-500 text-white" : "border-orange-400/50 text-orange-400 hover:bg-orange-400/10");
  const msgCls = "mb-4 py-2.5 px-4 rounded-xl text-sm text-center " +
    (csvMsg.startsWith("Imported") ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300");

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex justify-between items-center mt-4 mb-5">
        <h2 className="text-xl font-bold">Record a Run</h2>
        <button onClick={() => setImp(v => !v)} className={impBtnCls}>
          <Upload size={14}/>Import CSV
        </button>
      </div>

      {csvMsg && <div className={msgCls}>{csvMsg}</div>}

      {openTracker && !prefill?.source && (
        <>
          <button onClick={openTracker}
            className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl text-sm font-semibold transition-colors mb-4">
            <MapPin size={16}/>Track a run live (GPS)
          </button>
          <div className="flex items-center gap-3 mb-5 text-xs uppercase tracking-widest text-slate-500">
            <div className="h-px flex-1 bg-slate-700"/>or enter manually<div className="h-px flex-1 bg-slate-700"/>
          </div>
        </>
      )}

      {prefill?.source === "gps" && (
        <div className="bg-emerald-500/15 text-emerald-300 text-sm rounded-xl px-4 py-2.5 mb-5">
          Tracked by GPS — distance, time and elevation are filled in. Add a type and notes, then save.
        </div>
      )}

      {showImp && (
        <div className="bg-slate-800 rounded-2xl p-4 mb-5 border border-slate-700 space-y-2.5">
          <p className="text-sm font-semibold text-slate-200">Import from Zepp or Strava</p>
          <p className="text-xs text-slate-500">
            <span className="text-slate-300">Zepp:</span> Profile → Privacy Center → Export Personal Data<br/>
            <span className="text-slate-300">Strava:</span> Settings → My Account → Download or Delete → Request Archive
          </p>
          <input ref={fRef} type="file" accept=".csv" onChange={handleCSV} className="hidden"/>
          <button onClick={() => fRef.current?.click()}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">
            Choose CSV file
          </button>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={LABEL_CLS}>Date</label>
            <input type="date" value={f.date} onChange={e => set("date", e.target.value)} className={INPUT_CLS}/></div>
          <div><label className={LABEL_CLS}>Type</label>
            <select value={f.type} onChange={e => set("type", e.target.value)} className={INPUT_CLS}>
              {["EASY","TEMPO","LONG","INTERVALS","RACE","WALK","OTHER"].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div><label className={LABEL_CLS}>Distance (km)</label>
          <input type="number" step="0.01" min="0" placeholder="e.g. 8.5" value={f.km}
            onChange={e => set("km", e.target.value)} className={INPUT_CLS}/></div>
        <div><label className={LABEL_CLS}>Duration</label>
          <div className="grid grid-cols-3 gap-2">
            <input type="number" min="0" max="23" placeholder="h"   value={f.dH} onChange={e => set("dH", e.target.value)} className={INPUT_CLS}/>
            <input type="number" min="0" max="59" placeholder="min" value={f.dM} onChange={e => set("dM", e.target.value)} className={INPUT_CLS}/>
            <input type="number" min="0" max="59" placeholder="sec" value={f.dS} onChange={e => set("dS", e.target.value)} className={INPUT_CLS}/>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className={LABEL_CLS}>Avg HR</label>
            <input type="number" placeholder="e.g. 145" value={f.hr} onChange={e => set("hr", e.target.value)} className={INPUT_CLS}/></div>
          <div><label className={LABEL_CLS}>Max HR</label>
            <input type="number" placeholder="e.g. 170" value={f.hrMax} onChange={e => set("hrMax", e.target.value)} className={INPUT_CLS}/></div>
          <div><label className={LABEL_CLS}>Elev (m)</label>
            <input type="number" placeholder="e.g. 80" value={f.elev} onChange={e => set("elev", e.target.value)} className={INPUT_CLS}/></div>
        </div>
        {prefill?.hrPending && !f.hr && (
          <p className="text-xs text-slate-400 flex items-start gap-1.5">
            <HeartPulse size={14} className="text-red-400 mt-0.5 shrink-0" />
            <span>Heart rate will be added automatically from Health Connect once your
              watch syncs (usually a few minutes) — leave these blank, or enter them yourself.</span>
          </p>
        )}
        <div>
          <label className={LABEL_CLS}>{"Perceived effort: "}<span className="text-white font-semibold">{f.effort + "/10"}</span></label>
          <input type="range" min="1" max="10" value={f.effort} onChange={e => set("effort", e.target.value)} className="w-full accent-orange-500"/>
        </div>
        <div><label className={LABEL_CLS}>Notes</label>
          <textarea rows={2} placeholder="How did it feel? Any aches?" value={f.notes}
            onChange={e => set("notes", e.target.value)} className={INPUT_CLS + " resize-none"}/></div>
        <button onClick={submit} disabled={busy}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3.5 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2">
          {busy ? <Loader size={18} className="animate-spin"/> : <Plus size={18}/>}
          Save Run
        </button>
      </div>
    </div>
  );
}
