import { HR_ZONES, hrZoneBpm } from "../utils/hr";

type HRZoneBarProps = { effMax: number; restHR: number };

// The slim five-colour zone bar with rest/max bpm labels. Shared by the Settings
// HR editor (live preview) and the Progress → Stats zones card, so the two never
// drift. Caller guards on a valid profile (effMax > restHR).
export function HRZoneBar({effMax, restHR}: HRZoneBarProps) {
  return (
    <div>
      <div className="flex rounded-xl overflow-hidden h-9 mb-3">
        {HR_ZONES.map(z => {
          const r = hrZoneBpm(z.lo, z.hi, effMax, restHR);
          return (
            <div key={z.n} className="flex-1 flex flex-col items-center justify-center" style={{background:z.clr}}>
              <span className="text-xs font-black text-slate-900">{z.n}</span>
              {r && <span className="font-semibold text-slate-800 leading-none" style={{fontSize:9}}>{r.lo}</span>}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-slate-400 px-1">
        <span>{restHR + " bpm (rest)"}</span>
        <span>{effMax + " bpm (max)"}</span>
      </div>
    </div>
  );
}
