import { useState } from "react";
import { History, Pencil, Trash2 } from "lucide-react";
import { TCLR, runBarColor } from "../constants";
import { fmt } from "../utils/format";
import { EditRunModal } from "../modals/EditRunModal";

// The full run log, newest first, grouped by month.
export function HistoryView({runs, deleteRun, updateRun, goTab}) {
  const [confirmId, setConfirmId] = useState(null);
  const [editRun,   setEditRun]   = useState(null);

  if (!runs.length) return (
    <div className="max-w-lg mx-auto flex flex-col items-center justify-center pt-24 text-center gap-3 p-4">
      <History size={48} className="text-slate-700"/>
      <p className="text-slate-400">No runs logged yet.</p>
      <button onClick={() => goTab && goTab("log")}
        className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors">
        Log your first run
      </button>
    </div>
  );

  // Runs arrive newest-first; bucket them into month sections in that order.
  const totKm  = runs.reduce((s, r) => s + (r.km || 0), 0);
  const groups = [];
  runs.forEach(r => {
    const key = new Date(r.date + "T12:00:00").toLocaleDateString("en-GB", {month:"long", year:"numeric"});
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = {key, items:[]}; groups.push(g); }
    g.items.push(r);
  });

  return (
    <div className="max-w-lg mx-auto p-4">
      <div className="mt-4 mb-4">
        <h2 className="text-xl font-bold">History</h2>
        <p className="text-slate-500 text-xs mt-0.5">
          {runs.length + " run" + (runs.length === 1 ? "" : "s") + " · " + totKm.toFixed(0) + " km total"}
        </p>
      </div>

      <div className="space-y-5">
        {groups.map(g => (
          <div key={g.key}>
            <p className="text-slate-500 text-xs uppercase tracking-widest mb-2">{g.key}</p>
            <div className="space-y-2">
              {g.items.map(r => {
                const pace = r.km && r.durationSec ? r.durationSec / r.km : 0;
                return (
                  <div key={r.id} className="bg-slate-800 rounded-xl p-3 flex items-center gap-3">
                    <div className={"w-1.5 h-10 rounded-full flex-shrink-0 " + runBarColor(r.type)}/>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{r.km + " km · " + fmt.dur(r.durationSec)}</p>
                      <p className="text-slate-400 text-xs">
                        {fmt.date(r.date) + " · " + fmt.pace(pace) + "/km" + (r.hr ? " · ❤️ " + r.hr : "") + (r.elevation ? " · ⛰️ " + r.elevation + "m" : "")}
                      </p>
                      {r.notes && <p className="text-slate-400 text-xs mt-0.5 truncate">{r.notes}</p>}
                    </div>
                    <span className={"text-xs font-semibold flex-shrink-0 " + (TCLR[r.type] || TCLR.OTHER)}>{r.type}</span>
                    {confirmId === r.id ? (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => { deleteRun(r.id); setConfirmId(null); }}
                          className="text-xs font-semibold text-red-400 hover:text-red-300 px-1.5 py-1">Delete</button>
                        <button onClick={() => setConfirmId(null)}
                          className="text-xs text-slate-500 hover:text-slate-300 px-1.5 py-1">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => setEditRun(r)} aria-label="Edit run"
                          className="text-slate-400 hover:text-orange-400 p-1 transition-colors">
                          <Pencil size={15}/>
                        </button>
                        <button onClick={() => setConfirmId(r.id)} aria-label="Delete run"
                          className="text-slate-400 hover:text-red-400 p-1 transition-colors">
                          <Trash2 size={15}/>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {editRun && <EditRunModal run={editRun}
        onSave={patch => updateRun(editRun.id, patch)}
        onClose={() => setEditRun(null)}/>}
    </div>
  );
}
