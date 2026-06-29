import { useState } from "react";
import { Heart } from "lucide-react";
import { INPUT_CLS } from "../constants";
import { fmt } from "../utils/format";
import { HR_ZONES, hrZoneBpm } from "../utils/hr";

export function HRZones({settings, saveSettings, runs}) {
  const [age,    setAge]    = useState(String(settings.age || ""));
  const [maxHR,  setMaxHR]  = useState(String(settings.maxHR || ""));
  const [restHR, setRestHR] = useState(String(settings.restHR || 60));
  const [maxHRHint, setMaxHRHint] = useState("");

  const ageN  = parseInt(age)    || 0;
  const mhrN  = parseInt(maxHR)  || 0;
  const rhrN  = parseInt(restHR) || 60;
  const tanakaMax  = ageN ? Math.round(208 - 0.7 * ageN) : null;
  const effMax = mhrN || tanakaMax || 0;
  const hrr    = effMax - rhrN;
  const ready  = effMax > 0 && rhrN > 0 && hrr > 0;

  const getZone = z => hrZoneBpm(z.lo, z.hi, effMax, rhrN);

  // Settings fields auto-save on blur (no Save button) — commit reads the
  // coalesced numbers; estimateHR persists explicitly since setState is async.
  const commit = () => {
    saveSettings({...settings, age:ageN, maxHR:mhrN||tanakaMax||0, restHR:rhrN});
  };

  const estimateHR = () => {
    if (!tanakaMax) { setMaxHRHint("Enter your age above to estimate it."); return; }
    setMaxHR(String(tanakaMax));
    setRestHR("60");
    setMaxHRHint("Estimated from age (Tanaka, 208 − 0.7×age): " + tanakaMax + " bpm max HR, with a typical 60 bpm resting HR.");
    saveSettings({...settings, age:ageN, maxHR:tanakaMax, restHR:60});
  };

  const getRunZone = hr => {
    if (!ready || !hr) return null;
    const idx = HR_ZONES.findIndex((z, i) => {
      const r = getZone(z);
      if (!r) return false;
      return i === HR_ZONES.length - 1 ? hr >= r.lo : hr >= r.lo && hr < r.hi;
    });
    return idx >= 0 ? idx + 1 : null;
  };

  const hrRuns = runs.filter(r => r.hr).slice(0, 6);

  return (
    <div className="space-y-5">
      <div className="bg-slate-800 rounded-2xl p-4 space-y-4">
        <p className="text-sm font-semibold text-slate-200">Heart Rate</p>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-xs text-slate-400 block mb-1.5">Age</label>
            <input type="number" min="10" max="90" placeholder="35" value={age} onChange={e => setAge(e.target.value)} onBlur={commit} className={INPUT_CLS}/></div>
          <div><label className="text-xs text-slate-400 block mb-1.5">Max HR</label>
            <input type="number" min="100" max="230" placeholder="auto" value={maxHR} onChange={e => setMaxHR(e.target.value)} onBlur={commit} className={INPUT_CLS}/></div>
          <div><label className="text-xs text-slate-400 block mb-1.5">Rest HR</label>
            <input type="number" min="30" max="120" placeholder="60" value={restHR} onChange={e => setRestHR(e.target.value)} onBlur={commit} className={INPUT_CLS}/></div>
        </div>

        <div>
          {!mhrN && (
            <button type="button" onClick={estimateHR}
              className="text-xs text-sky-300 hover:text-sky-200 underline underline-offset-2 transition-colors">
              I don&apos;t know my heart rate
            </button>
          )}
          {maxHRHint && <p className="text-xs text-slate-500 mt-1.5">{maxHRHint}</p>}
        </div>
      </div>

      {ready ? (
        <div className="space-y-5">
          <div className="bg-slate-800 rounded-2xl p-4">
            <p className="text-sm font-semibold text-slate-200 mb-4">Heart Rate Zones</p>
            <div className="flex rounded-xl overflow-hidden h-9 mb-3">
              {HR_ZONES.map(z => {
                const r = getZone(z);
                return (
                  <div key={z.n} className="flex-1 flex flex-col items-center justify-center" style={{background:z.clr}}>
                    <span className="text-xs font-black text-slate-900">{z.n}</span>
                    {r && <span className="font-semibold text-slate-800 leading-none" style={{fontSize:9}}>{r.lo}</span>}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-slate-400 mb-4 px-1">
              <span>{rhrN + " bpm (rest)"}</span>
              <span>{effMax + " bpm (max)"}</span>
            </div>
            <div className="space-y-1">
              {HR_ZONES.map(z => {
                const r = getZone(z);
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
            {"Zone HR = ((MaxHR - RestHR) x intensity%) + RestHR. HRR = " + effMax + " - " + rhrN + " = " + hrr + " bpm. Accounts for your resting HR and fitness, so it's more accurate than plain % of Max HR."}
          </div>

          {hrRuns.length > 0 && (
            <div className="bg-slate-800 rounded-2xl p-4">
              <p className="text-sm font-semibold text-slate-200 mb-3">Recent runs — zone analysis</p>
              <div className="space-y-1">
                {hrRuns.map(r => {
                  const zIdx  = getRunZone(r.hr);
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
      ) : (
        <div className="bg-slate-800 rounded-2xl p-8 text-center">
          <Heart size={36} className="mx-auto mb-3 text-slate-700"/>
          <p className="text-slate-400 text-sm">Enter your age and/or Max HR above</p>
          <p className="text-slate-600 text-xs mt-1">to calculate your personalised heart rate zones</p>
        </div>
      )}
    </div>
  );
}
