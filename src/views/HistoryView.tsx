// @ts-nocheck
import { useEffect, useState } from "react";
import { History, Pencil, Trash2, Map as MapIcon } from "lucide-react";
import { fmt } from "../utils/format";
import { RunRow } from "../components/RunRow";
import { RouteMap } from "../components/RouteMap";
import { getRoute, getPendingRoute } from "../routes";
import { EditRunModal } from "../modals/EditRunModal";

// Lazy-loads and renders a run's saved GPS trace (kept out of the runs blob). A
// synced run fetches from Supabase; one still pending upload reads the trace
// straight from the offline queue so it's viewable before it syncs.
function RouteMapLoader({run}) {
  const [route, setRoute] = useState(() => run.routeId ? undefined : getPendingRoute(run.routeTmp));
  useEffect(() => {
    if (!run.routeId) return; // pending route already pulled from localStorage
    let on = true;
    getRoute(run.routeId).then(r => on && setRoute(r)).catch(() => on && setRoute(null));
    return () => { on = false; };
  }, [run.routeId]);
  if (route === undefined)
    return <div className="h-20 rounded-xl bg-slate-800 flex items-center justify-center text-slate-500 text-sm">Loading route…</div>;
  if (!route)
    return <div className="h-20 rounded-xl bg-slate-800 flex items-center justify-center text-slate-500 text-sm">Route unavailable.</div>;
  return (
    <>
      {!run.routeId && (
        <p className="text-[11px] text-amber-400 text-center">Saved on this device — will sync to the cloud when possible.</p>
      )}
      <RouteMap points={route.points} interactive className="h-56 rounded-xl overflow-hidden"/>
    </>
  );
}

// The full run log, newest first, grouped by month.
export function HistoryView({runs, deleteRun, updateRun, goTab}) {
  const [confirmId, setConfirmId] = useState(null);
  const [editRun,   setEditRun]   = useState(null);
  const [mapId,     setMapId]     = useState(null);

  if (!runs.length) return (
    <div className="max-w-lg mx-auto flex flex-col items-center justify-center pt-24 text-center gap-3 p-4">
      <History size={48} className="text-slate-700"/>
      <p className="text-slate-400">No runs recorded yet.</p>
      <button onClick={() => goTab && goTab("log")}
        className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors">
        Record your first run
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
        <p className="text-slate-400 text-xs mt-0.5">
          {runs.length + " run" + (runs.length === 1 ? "" : "s") + " · " + totKm.toFixed(0) + " km total"}
        </p>
      </div>

      <div className="space-y-5">
        {groups.map(g => (
          <div key={g.key}>
            <p className="text-slate-400 text-xs uppercase tracking-widest mb-2">{g.key}</p>
            <div className="space-y-2">
              {g.items.map(r => (
                <div key={r.id} className="space-y-2">
                  <RunRow run={r} dateFmt={fmt.date} showNotes actions={
                    confirmId === r.id ? (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => { deleteRun(r.id); setConfirmId(null); setMapId(m => m === r.id ? null : m); }}
                          className="text-xs font-semibold text-red-400 hover:text-red-300 px-2 py-2">Delete</button>
                        <button onClick={() => setConfirmId(null)}
                          className="text-xs text-slate-400 hover:text-slate-200 px-2 py-2">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        {(r.routeId || r.routeTmp) && (
                          <button onClick={() => setMapId(mapId === r.id ? null : r.id)} aria-label="View route"
                            className={"flex items-center justify-center transition-colors " + (mapId === r.id ? "text-orange-400" : "text-slate-400 hover:text-orange-400")} style={{minWidth:40, minHeight:40}}>
                            <MapIcon size={16}/>
                          </button>
                        )}
                        <button onClick={() => setEditRun(r)} aria-label="Edit run"
                          className="flex items-center justify-center text-slate-400 hover:text-orange-400 transition-colors" style={{minWidth:40, minHeight:40}}>
                          <Pencil size={16}/>
                        </button>
                        <button onClick={() => setConfirmId(r.id)} aria-label="Delete run"
                          className="flex items-center justify-center text-slate-400 hover:text-red-400 transition-colors" style={{minWidth:40, minHeight:40}}>
                          <Trash2 size={16}/>
                        </button>
                      </div>
                    )
                  }/>
                  {mapId === r.id && (r.routeId || r.routeTmp) && <RouteMapLoader run={r}/>}
                </div>
              ))}
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
