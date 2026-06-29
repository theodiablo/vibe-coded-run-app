import { DAYS } from "../constants";
import { fmt } from "../utils/format";

// Pick training days and per-day durations; the longest becomes the long run.
export function SessionConfigurator({sessions, onChange}) {
  const toggle = dOff => {
    const has = sessions.find(s => s.dayOffset === dOff);
    if (has) {
      if (sessions.length <= 1) return;
      onChange(sessions.filter(s => s.dayOffset !== dOff));
    } else {
      onChange(sessions.concat({dayOffset: dOff, minutes: 45}).sort((a, b) => a.dayOffset - b.dayOffset));
    }
  };
  const setMins = (dOff, m) => onChange(sessions.map(s => s.dayOffset === dOff ? {...s, minutes: m} : s));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((d, i) => {
          const sel = sessions.find(s => s.dayOffset === i);
          return (
            <button key={i} onClick={() => toggle(i)}
              className={"py-2 rounded-lg text-xs font-semibold transition-colors " + (sel ? "bg-orange-500 text-white" : "bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600")}>
              {d}
            </button>
          );
        })}
      </div>
      <div className="space-y-2">
        {sessions.slice().sort((a, b) => a.dayOffset - b.dayOffset).map(s => (
          <div key={s.dayOffset} className="flex items-center gap-3 bg-slate-700/60 rounded-xl px-3 py-2.5">
            <span className="text-sm font-bold text-orange-300 w-8 flex-shrink-0">{DAYS[s.dayOffset]}</span>
            <div className="grid grid-cols-6 gap-1 flex-1">
              {[20, 30, 45, 60, 75, 90, 120, 150, 180].map(m => (
                <button key={m} onClick={() => setMins(s.dayOffset, m)}
                  className={"py-1 rounded-md text-xs transition-colors " + (s.minutes === m ? "bg-orange-500 text-white" : "bg-slate-600 text-slate-400 hover:text-white")}>
                  {fmt.mins(m)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500 text-center">The longest session automatically becomes your long run.</p>
    </div>
  );
}
