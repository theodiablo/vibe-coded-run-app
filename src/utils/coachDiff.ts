// Pure plan-diff for the coach chat: what did the proposal change, per week?
// Sessions are matched by id (stable across edits — the coach tools never
// change ids). Returns [{ weekNumber, changes: [string] }] in week order.
import { currentLocaleTag, t } from "../i18n";
import type { Plan, PlanSession } from "../types";

const short = (ymd: string) => {
  const d = new Date(ymd + "T12:00:00");
  return d.toLocaleDateString(currentLocaleTag(), { weekday: "short", day: "numeric", month: "short" });
};

export function diffPlans(oldPlan: Plan | null | undefined, newPlan: Plan | null | undefined) {
  const before: Record<string, PlanSession> = {};
  (oldPlan?.weeks || []).forEach(w => w.sessions.forEach(s => { before[s.id] = s; }));
  const out: { weekNumber: number; changes: string[] }[] = [];
  for (const w of newPlan?.weeks || []) {
    const changes: string[] = [];
    for (const s of w.sessions) {
      const b = before[s.id];
      if (!b) { changes.push(t("coach.diff.new", { type: s.type, km: s.km, date: short(s.date) })); continue; }
      const parts: string[] = [];
      if (b.type !== s.type) parts.push(`${t("common.types." + b.type, { defaultValue: b.type })} → ${t("common.types." + s.type, { defaultValue: s.type })}`);
      if (b.date !== s.date) parts.push(t("coach.diff.moved", { from: short(b.date), to: short(s.date) }));
      if (b.km !== s.km) parts.push(`${b.km} → ${s.km} km`);
      if (parts.length) changes.push(`${short(s.date)}: ${parts.join(", ")}`);
    }
    if (changes.length) out.push({ weekNumber: w.weekNumber, changes });
  }
  return out;
}
