import { useTranslation } from "react-i18next";
import { DAYS } from "../constants";
import { dayName } from "../i18n";
import { fmt } from "../utils/format";
import type { PlanSessionInput } from "../utils/plan";

type SessionConfiguratorProps = {
  sessions: PlanSessionInput[];
  onChange: (sessions: PlanSessionInput[]) => void;
  // Optional coach-pick recommendation (dayOffset → minutes). A recommended day
  // that isn't selected shows as a dashed pill; a recommended duration that isn't
  // the current pick shows as a dashed chip — "tap to accept, or choose your own".
  recommend?: Record<number, number>;
  // Legend shown under the grid when `recommend` is provided (caller supplies the
  // localized string so this component stays namespace-agnostic).
  legend?: string;
};

// Pick training days and per-day durations; the longest becomes the long run.
export function SessionConfigurator({sessions, onChange, recommend, legend}: SessionConfiguratorProps) {
  const { t } = useTranslation();
  const toggle = (dOff: number) => {
    const has = sessions.find(s => s.dayOffset === dOff);
    if (has) {
      if (sessions.length <= 1) return;
      onChange(sessions.filter(s => s.dayOffset !== dOff));
    } else {
      // Seed a newly-added day with its coach-pick minutes when there is one.
      const seed = recommend?.[dOff] ?? 45;
      onChange(sessions.concat({dayOffset: dOff, minutes: seed}).sort((a, b) => a.dayOffset - b.dayOffset));
    }
  };
  const setMins = (dOff: number, m: number) => onChange(sessions.map(s => s.dayOffset === dOff ? {...s, minutes: m} : s));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((_, i) => {
          const sel = sessions.find(s => s.dayOffset === i);
          const rec = recommend?.[i] != null;
          const cls = sel
            ? "bg-orange-500 text-white"
            : rec
              ? "bg-transparent text-orange-300 border border-dashed border-orange-500/70 hover:bg-orange-500/10"
              : "bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600";
          return (
            <button key={i} onClick={() => toggle(i)}
              className={"py-2 rounded-lg text-xs font-semibold transition-colors " + cls}>
              {dayName(i)}
            </button>
          );
        })}
      </div>
      <div className="space-y-2">
        {sessions.slice().sort((a, b) => a.dayOffset - b.dayOffset).map(s => (
          <div key={s.dayOffset} className="flex items-center gap-3 bg-slate-700/60 rounded-xl px-3 py-2.5">
            <span className="text-sm font-bold text-orange-300 w-8 flex-shrink-0">{dayName(s.dayOffset)}</span>
            <div className="grid grid-cols-6 gap-1 flex-1">
              {[20, 30, 45, 60, 75, 90, 120, 150, 180].map(m => {
                const isRec = recommend?.[s.dayOffset] === m;
                const cls = s.minutes === m
                  ? "bg-orange-500 text-white"
                  : isRec
                    ? "bg-transparent text-orange-300 border border-dashed border-orange-500/70"
                    : "bg-slate-600 text-slate-400 hover:text-white";
                return (
                  <button key={m} onClick={() => setMins(s.dayOffset, m)}
                    className={"py-1 rounded-md text-xs transition-colors " + cls}>
                    {fmt.mins(m)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {legend && <p className="text-xs text-slate-500 leading-snug">{legend}</p>}
      <p className="text-xs text-slate-500 text-center">{t("onboarding.sessions.longestNote")}</p>
    </div>
  );
}
