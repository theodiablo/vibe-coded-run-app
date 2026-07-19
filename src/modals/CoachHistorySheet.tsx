import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader, MessageSquareText } from "lucide-react";
import { useDismissable } from "../hooks/useDismissable";
import { listCoachTrajectories, fetchCoachTranscript, type CoachTrajectorySummary, type CoachTranscript, type TrajectoryStatus } from "../coachHistory";
import { fmt } from "../utils/format";
import { track } from "../telemetry";
import type { Plan } from "../types";

// Per-status tag styling. `open` is the only actionable one (resume), so it gets
// the orange accent + a highlighted row; the rest are read-only transcripts.
const STATUS_STYLE: Record<TrajectoryStatus, { color: string; row: string }> = {
  open: { color: "#f97316", row: "border-[#f9731640] bg-[#152238]" },
  accepted: { color: "#34d399", row: "border-slate-700/60 bg-slate-800/40" },
  abandoned: { color: "#64748b", row: "border-slate-700/60 bg-slate-800/40" },
  no_valid_adjustment: { color: "#64748b", row: "border-slate-700/60 bg-slate-800/40" },
};

type Props = {
  currentPlan: Plan;
  onClose: () => void;
  onOpen: (traj: CoachTrajectorySummary, transcript: CoachTranscript) => void;
  showToast: (msg: string, type?: string) => void;
};

// Bottom sheet listing the user's recent coach conversations (last 30 days).
// Tapping an open one resumes it; tapping a closed one loads a read-only
// transcript. All data comes from the audit rows via src/coachHistory.ts (a
// free read — no model call).
export function CoachHistorySheet({ currentPlan, onClose, onOpen, showToast }: Props) {
  const { t } = useTranslation();
  useDismissable(true, onClose);

  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [rows, setRows] = useState<CoachTrajectorySummary[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);

  // The state resolves in async callbacks (not synchronously in the effect), so
  // the initial mount just kicks the fetch — state already starts at "loading".
  const fetchRows = () => {
    listCoachTrajectories()
      .then(list => { setRows(list); setState("ready"); })
      .catch(() => setState("error"));
  };
  const retry = () => { setState("loading"); fetchRows(); };
  useEffect(() => { track("coach_history_opened", {}); fetchRows(); }, []);

  const openRow = async (traj: CoachTrajectorySummary) => {
    if (openingId) return;
    setOpeningId(traj.id);
    try {
      const transcript = await fetchCoachTranscript(traj.id, {
        isOpen: traj.status === "open",
        currentPlan,
      });
      onOpen(traj, transcript);
    } catch {
      showToast(t("coach.toast.historyLoadFailed"));
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0" style={{ background: "rgba(4,8,15,0.55)" }} onClick={onClose} />
      <div
        className="relative flex flex-col rounded-t-[20px] border-t border-slate-700 animate-slide-up"
        style={{ background: "#0f1a2b", maxHeight: "72%", paddingBottom: "var(--safe-bottom)" }}
      >
        <div className="flex flex-col items-center pt-2.5 pb-1 flex-shrink-0">
          <div className="h-1 w-9 rounded-full bg-slate-600" />
        </div>
        <div className="flex items-baseline justify-between px-4 pb-2 flex-shrink-0">
          <h2 className="text-sm font-semibold text-slate-100">{t("coach.history.title")}</h2>
          <span className="text-[11px] text-slate-500">{t("coach.history.window")}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3 max-w-lg w-full mx-auto">
          {state === "loading" && (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-sm">
              <Loader size={16} className="animate-spin" />{t("coach.history.loading")}
            </div>
          )}
          {state === "error" && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-slate-400">{t("coach.history.loadFailed")}</p>
              <button onClick={retry} className="text-xs bg-slate-800 border border-slate-700 hover:border-orange-400/60 text-slate-200 rounded-full px-4 py-1.5 transition-colors">
                {t("coach.history.retry")}
              </button>
            </div>
          )}
          {state === "ready" && rows.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 text-center px-6">
              <MessageSquareText size={22} className="text-slate-600" />
              <p className="text-sm text-slate-400">{t("coach.history.empty")}</p>
            </div>
          )}
          {state === "ready" && rows.map(row => {
            const st = STATUS_STYLE[row.status];
            const busy = openingId === row.id;
            return (
              <button
                key={row.id}
                onClick={() => openRow(row)}
                disabled={!!openingId}
                className={"w-full text-left flex items-center gap-3 rounded-xl border px-3 py-2.5 mb-2 transition-colors disabled:opacity-60 " + st.row + " hover:border-orange-400/50"}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200 truncate">{row.preview || t("coach.title")}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{fmt.sht(row.createdAt.slice(0, 10))}</p>
                </div>
                {busy
                  ? <Loader size={14} className="animate-spin text-slate-400 shrink-0" />
                  : <span className="text-[10px] font-bold uppercase tracking-wide shrink-0" style={{ color: st.color }}>{t("coach.history.status." + row.status)}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
