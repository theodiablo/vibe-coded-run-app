// Pure plan-diff for the coach chat: what did the proposal change, per week?
// Sessions are matched by id (stable across edits — the coach tools never
// change ids). Returns [{ weekNumber, changes: [string] }] in week order.

const short = (ymd) => {
  const d = new Date(ymd + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

export function diffPlans(oldPlan, newPlan) {
  const before = {};
  (oldPlan?.weeks || []).forEach(w => w.sessions.forEach(s => { before[s.id] = s; }));
  const out = [];
  for (const w of newPlan?.weeks || []) {
    const changes = [];
    for (const s of w.sessions) {
      const b = before[s.id];
      if (!b) { changes.push(`new ${s.type} · ${s.km} km on ${short(s.date)}`); continue; }
      const parts = [];
      if (b.type !== s.type) parts.push(`${b.type} → ${s.type}`);
      if (b.date !== s.date) parts.push(`moved ${short(b.date)} → ${short(s.date)}`);
      if (b.km !== s.km) parts.push(`${b.km} → ${s.km} km`);
      if (parts.length) changes.push(`${short(s.date)}: ${parts.join(", ")}`);
    }
    if (changes.length) out.push({ weekNumber: w.weekNumber, changes });
  }
  return out;
}
