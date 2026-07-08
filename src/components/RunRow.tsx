import { TCLR, runBarColor } from "../constants";
import { fmt } from "../utils/format";
import type { ReactNode } from "react";
import type { Run, RunType } from "../types";

type RunRowProps = {
  run: Run;
  dateFmt?: (date: string) => string;
  showNotes?: boolean;
  actions?: ReactNode;
};

const typeClass = (type: Run["type"]) => TCLR[(type as RunType) || "OTHER"] || TCLR.OTHER;

// One run as a list row: colored type bar, distance + duration, a metrics
// sub-line (date · pace · HR · elevation), the type badge, and an optional
// right-side `actions` slot. Shared by the dashboard's recent-runs list and the
// full History view so the two never drift apart.
export function RunRow({run, dateFmt = fmt.sht, showNotes = false, actions = null}: RunRowProps) {
  const pace = run.km && run.durationSec ? run.durationSec / run.km : 0;
  return (
    <div className="bg-slate-800 rounded-xl p-3 flex items-center gap-3">
      <div className={"w-1.5 h-10 rounded-full flex-shrink-0 " + runBarColor(run.type || "OTHER")}/>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium">{run.km + " km · " + fmt.dur(run.durationSec)}</p>
        <p className="text-slate-400 text-xs">
          {dateFmt(run.date) + " · " + fmt.pace(pace) + "/km"
            + (run.hr ? " · ❤️ " + run.hr : "")
            + (run.elevation ? " · ⛰️ " + run.elevation + "m" : "")}
        </p>
        {showNotes && run.notes && <p className="text-slate-400 text-xs mt-0.5 truncate">{run.notes}</p>}
      </div>
      <span className={"text-xs font-semibold flex-shrink-0 " + typeClass(run.type)}>{run.type}</span>
      {actions}
    </div>
  );
}
