import { fmt } from "../utils/format";
import { HR_ZONES, hrZoneBpm, runZoneIndex } from "../utils/hr";
import { HRZoneBar } from "./HRZoneBar";

// Heart-rate zones reference + recent-run zone breakdown, shown in Progress →
// Stats. Reads the persisted HR profile from settings (configured in Settings →
// Profile); renders nothing until a usable profile exists.
export function HRZonesCard({runs, settings}) {
  const effMax = settings.maxHR || (settings.age ? Math.round(208 - 0.7 * settings.age) : 0);
  const restHR = settings.restHR || 60;
  const hrr    = effMax - restHR;
  if (!(effMax > 0 && hrr > 0)) return null;

  const hrRuns = runs.filter(r => r.hr).slice(0, 6);

  return (
    <div className="p-4 space-y-5">
      <div className="bg-slate-800 rounded-2xl p-4">
        <p className="text-sm font-semibold text-slate-200 mb-4">Heart Rate Zones</p>
        <div className="mb-4"><HRZoneBar effMax={effMax} restHR={restHR}/></div>
        <div className="space-y-1">
          {HR_ZONES.map(z => {
            const r = hrZoneBpm(z.lo, z.hi, effMax, restHR);
            const aeroClass = z.type === "Aerobic"
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-orange-500/15 text-orange-400";
            return (
              <div key={z.n} className="flex items-center gap-3 py-2.5 border-b border-slate-700/50 last:border-0">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{background:z.clr}}/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{"Z" + z.n + " · " + z.name}</span>
                    <span className={"text-xs px-1.5 py-0.5 rounded-full " + aeroClass}>{z.type}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 leading-snug">{z.desc}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-white">{r ? (r.lo + "–" + r.hi) : "-"}</p>
                  <p className="text-xs text-slate-500">{Math.round(z.lo*100) + "–" + Math.round(z.hi*100) + "%"}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl p-3 text-xs text-slate-500 leading-relaxed">
        <span className="text-slate-300 font-medium">Karvonen method: </span>
        {"Zone HR = ((MaxHR - RestHR) x intensity%) + RestHR. HRR = " + effMax + " - " + restHR + " = " + hrr + " bpm. Accounts for your resting HR and fitness, so it's more accurate than plain % of Max HR."}
      </div>

      {hrRuns.length > 0 && (
        <div className="bg-slate-800 rounded-2xl p-4">
          <p className="text-sm font-semibold text-slate-200 mb-3">Recent runs — zone analysis</p>
          <div className="space-y-1">
            {hrRuns.map(r => {
              const zIdx  = runZoneIndex(r.hr, effMax, restHR);
              const zData = zIdx ? HR_ZONES[zIdx - 1] : null;
              return (
                <div key={r.id} className="flex items-center gap-3 py-2 border-b border-slate-700/30 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{fmt.sht(r.date) + " · " + r.km + " km"}</p>
                    <p className="text-xs text-slate-500">
                      {"Avg HR: "}<span className="text-red-400">{r.hr + " bpm"}</span>
                    </p>
                  </div>
                  {zData ? (
                    <div className="text-right flex-shrink-0">
                      <span className="text-xs font-semibold px-2 py-1 rounded-lg"
                        style={{background: zData.clr + "25", color: zData.clr}}>
                        {"Z" + zData.n + " · " + zData.name}
                      </span>
                      <p className={"text-xs mt-0.5 " + (zData.type === "Aerobic" ? "text-emerald-400" : "text-orange-400")}>
                        {zData.type}
                      </p>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-600">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
