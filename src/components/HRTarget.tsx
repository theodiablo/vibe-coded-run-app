import { Heart } from "lucide-react";
import { sessionHR } from "../utils/hr";

// Per-session heart-rate target shown on the dashboard and plan rows.
export function HRTarget({type, settings, openSettings}) {
  if (!settings.maxHR) {
    return (
      <button type="button" onClick={openSettings}
        className="text-xs mt-1 flex items-center gap-1.5 text-amber-300 hover:text-amber-200 transition-colors">
        <Heart size={12}/>Add your HR profile in Settings to see a target zone
      </button>
    );
  }
  const hr = sessionHR(type, settings);
  if (!hr) return null;
  return (
    <p className="text-xs mt-1 flex items-center gap-1.5 flex-wrap">
      <span className="font-semibold" style={{color:hr.clr}}>{"❤️ " + hr.lo + "–" + hr.hi + " bpm"}</span>
      <span className="text-slate-600">{"· " + hr.label}</span>
    </p>
  );
}
