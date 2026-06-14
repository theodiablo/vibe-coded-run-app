import { useState } from "react";
import { Check } from "lucide-react";
import { INPUT_CLS, LABEL_CLS } from "../constants";

// Edit an existing run — mirrors the fields on the Log a Run form.
export function EditRunModal({run, onSave, onClose}) {
  const sec = run.durationSec || 0;
  const [f, setF] = useState({
    date:  run.date,
    type:  run.type || "EASY",
    km:    run.km != null ? String(run.km) : "",
    dH:    String(Math.floor(sec / 3600) || ""),
    dM:    String(Math.floor((sec % 3600) / 60) || ""),
    dS:    String(sec % 60 || ""),
    hr:    run.hr        ? String(run.hr)        : "",
    hrMax: run.hrMax     ? String(run.hrMax)     : "",
    elev:  run.elevation ? String(run.elevation) : "",
    effort: run.effort || 5,
    notes:  run.notes || "",
  });
  const [err, setErr] = useState("");
  const set = (k, v) => setF(prev => ({...prev, [k]: v}));

  const save = () => {
    if (!f.km || (!f.dM && !f.dH)) { setErr("Distance and duration are required."); return; }
    const s = (parseInt(f.dH) || 0) * 3600 + (parseInt(f.dM) || 0) * 60 + (parseInt(f.dS) || 0);
    onSave({
      date: f.date, type: f.type, km: parseFloat(f.km), durationSec: s,
      hr:        f.hr    ? parseInt(f.hr)    : null,
      hrMax:     f.hrMax ? parseInt(f.hrMax) : null,
      elevation: f.elev  ? parseInt(f.elev)  : null,
      effort:    parseInt(f.effort), notes: f.notes,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl w-full max-w-lg border border-slate-700 flex flex-col max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center px-4 py-3 border-b border-slate-700 shrink-0">
          <p className="font-semibold text-sm">Edit Run</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none px-1">x</button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto">
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
            <input type="number" step="0.01" min="0" placeholder="8.5" value={f.km}
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
              <input type="number" placeholder="145" value={f.hr} onChange={e => set("hr", e.target.value)} className={INPUT_CLS}/></div>
            <div><label className={LABEL_CLS}>Max HR</label>
              <input type="number" placeholder="170" value={f.hrMax} onChange={e => set("hrMax", e.target.value)} className={INPUT_CLS}/></div>
            <div><label className={LABEL_CLS}>Elev (m)</label>
              <input type="number" placeholder="80" value={f.elev} onChange={e => set("elev", e.target.value)} className={INPUT_CLS}/></div>
          </div>
          <div>
            <label className={LABEL_CLS}>{"Perceived effort: "}<span className="text-white font-semibold">{f.effort + "/10"}</span></label>
            <input type="range" min="1" max="10" value={f.effort} onChange={e => set("effort", e.target.value)} className="w-full accent-orange-500"/>
          </div>
          <div><label className={LABEL_CLS}>Notes</label>
            <textarea rows={2} placeholder="How did it feel? Any aches?" value={f.notes}
              onChange={e => set("notes", e.target.value)} className={INPUT_CLS + " resize-none"}/></div>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <button onClick={save}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2">
            <Check size={18}/>Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
