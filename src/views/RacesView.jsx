import { useState } from "react";
import { Search, Star, Flag, Target, ExternalLink, X, Check, Plus, Trophy, ChevronRight } from "lucide-react";
import { INPUT_CLS, LABEL_CLS } from "../constants";
import { track } from "../telemetry";
import { fmt, ymd } from "../utils/format";
import { CURATED_RACES } from "../data/races";
import { findEdition, editionLabel, isPersonalBest } from "../utils/races";

const SEGMENTS = [["mine", "My Races"], ["browse", "Browse"]];

// Resolve a stored participation to its catalogue edition; fall back to the
// snapshot fields if the catalogue no longer lists it (orphan tolerance).
function resolveJoined(part) {
  const found = findEdition(part.editionId);
  if (found) return found;
  return {
    name: part.label || "Race", raceId: part.raceId, url: null, orphan: true,
    edition: { id: part.editionId, date: part.raceDate, distanceKm: part.distanceKm },
  };
}

export function RacesView({ races, saveRaces, settings, promoteEdition, setRaceInPlan, addRuns, showToast }) {
  const [seg, setSeg] = useState("mine");
  const [query, setQuery] = useState("");
  const [logFor, setLogFor] = useState(null); // editionId being logged
  const [expanded, setExpanded] = useState(null); // raceId expanded in Browse

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = ymd(today);
  const parts = races?.participations || [];
  const byId = Object.fromEntries(parts.map(p => [p.editionId, p]));

  // ── persistence ───────────────────────────────────────────────────────────
  const writeParts = next => saveRaces({ ...(races || {}), participations: next });

  const upsertPart = (joined, fields) => {
    const ed = joined.edition;
    const snapshot = {
      editionId: ed.id, raceId: joined.raceId,
      label: editionLabel(joined, ed), raceDate: ed.date, distanceKm: ed.distanceKm,
    };
    const exists = parts.some(p => p.editionId === ed.id);
    const next = exists
      ? parts.map(p => p.editionId === ed.id ? { ...p, ...fields } : p)
      : [...parts, { ...snapshot, status: "wishlist", timeSec: null, runId: null, source: "manual", notes: "", ...fields }];
    writeParts(next);
  };

  const removePart = editionId => writeParts(parts.filter(p => p.editionId !== editionId));

  const addWishlist = joined => {
    upsertPart(joined, { status: "wishlist" });
    showToast("Added to your races.");
  };

  const setTarget = joined => { promoteEdition(joined); };

  const saveResult = (joined, timeSec, notes, alsoLog) => {
    const ed = joined.edition;
    let runId = null;
    if (alsoLog) {
      runId = "r" + Date.now();
      addRuns([{
        id: runId, date: ed.date, type: "RACE", km: ed.distanceKm, durationSec: timeSec,
        hr: null, hrMax: null, elevation: ed.elevation || null, effort: 8,
        notes: notes || (editionLabel(joined, ed) + " — race"),
      }], { skipDetect: true });
    }
    upsertPart(joined, { status: "done", timeSec, notes, source: "manual", runId });
    track("race_completed", { source: "manual" });
    setLogFor(null);
    showToast("Race logged 🎉");
  };

  // ── My Races ──────────────────────────────────────────────────────────────
  const done = parts.filter(p => p.status === "done");
  const wishlist = parts.filter(p => p.status === "wishlist");
  const upcoming = wishlist.filter(p => p.raceDate >= todayStr).sort((a, b) => a.raceDate.localeCompare(b.raceDate));
  const past = wishlist.filter(p => p.raceDate < todayStr).sort((a, b) => b.raceDate.localeCompare(a.raceDate));

  return (
    <div className="max-w-lg mx-auto p-4">
      <h2 className="text-xl font-bold mt-4 mb-4">Races</h2>

      <div className="flex bg-slate-800 rounded-xl p-1 gap-1 mb-5">
        {SEGMENTS.map(([id, label]) => (
          <button key={id} onClick={() => setSeg(id)}
            className={"flex-1 py-1.5 rounded-lg text-sm font-semibold transition-colors " +
              (seg === id ? "bg-orange-500 text-white" : "text-slate-400 hover:text-slate-200")}>
            {label}
          </button>
        ))}
      </div>

      {seg === "mine" && (
        <div className="space-y-6">
          {!parts.length && (
            <div className="bg-slate-800 rounded-2xl p-6 text-center space-y-3">
              <Trophy size={32} className="mx-auto text-slate-700"/>
              <p className="text-sm text-slate-400">No races yet — pick a goal to chase.</p>
              <button onClick={() => setSeg("browse")}
                className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors">
                Add your first goal race
              </button>
            </div>
          )}

          {upcoming.length > 0 && (
            <Section title="Upcoming">
              {upcoming.map(p => {
                const joined = resolveJoined(p);
                const days = daysUntil(p.raceDate, today);
                const isTarget = settings.targetEditionId === p.editionId;
                // A race can be folded into the current plan when there's an active
                // plan (a race date is set) and this race falls before the main race
                // — a checkpoint along the way. We key off settings.raceDate rather
                // than targetEditionId so a hand-entered main race (no catalogue
                // edition) can still have tune-ups added.
                const inPlannable = settings.raceDate && !isTarget && p.raceDate < settings.raceDate;
                return (
                  <div key={p.editionId} className="rounded-2xl p-4 border border-orange-500/30"
                    style={{ background: "linear-gradient(135deg,rgba(249,115,22,.13),rgba(220,38,38,.13))" }}>
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{p.label}</p>
                        <p className="text-slate-400 text-sm mt-0.5">{fmt.date(p.raceDate) + " · " + p.distanceKm + " km"}</p>
                        {isTarget && <span className="inline-flex items-center gap-1 text-xs text-orange-300 mt-1.5 font-semibold"><Target size={12}/>Training target</span>}
                        {inPlannable && p.inPlan && <span className="inline-flex items-center gap-1 text-xs text-orange-300/80 mt-1.5 font-semibold"><Check size={12}/>In your plan</span>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-3xl font-black text-orange-400 leading-none">{Math.max(0, days)}</p>
                        <p className="text-slate-400 text-xs mt-0.5">days to go</p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      {!isTarget && (
                        <button onClick={() => setTarget(joined)}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-xl text-sm font-semibold transition-colors">
                          <Target size={14}/>Set as target
                        </button>
                      )}
                      {inPlannable && (
                        <button onClick={() => setRaceInPlan(p.editionId, !p.inPlan)}
                          title={p.inPlan ? "Remove from plan" : "Add this race to your plan"}
                          className={"flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-colors " + (p.inPlan ? "bg-orange-500/20 text-orange-300 hover:bg-orange-500/30" : "bg-slate-700 hover:bg-slate-600 text-slate-200")}>
                          {p.inPlan ? <><Check size={14}/>In plan</> : <><Plus size={14}/>Add to plan</>}
                        </button>
                      )}
                      <button onClick={() => setLogFor(p.editionId)}
                        className="flex items-center justify-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-2 rounded-xl text-sm font-semibold transition-colors">
                        <Check size={14}/>Done
                      </button>
                      <button onClick={() => removePart(p.editionId)} aria-label="Remove"
                        className="flex items-center justify-center text-slate-400 hover:text-red-400 px-2 transition-colors">
                        <X size={16}/>
                      </button>
                    </div>
                    {logFor === p.editionId && <ResultForm joined={joined} onSave={saveResult} onCancel={() => setLogFor(null)}/>}
                  </div>
                );
              })}
            </Section>
          )}

          {past.length > 0 && (
            <Section title="Did you run these?">
              {past.map(p => {
                const joined = resolveJoined(p);
                return (
                  <div key={p.editionId} className="rounded-xl p-4 border border-amber-500/25 bg-amber-500/5">
                    <p className="font-semibold">{p.label}</p>
                    <p className="text-slate-400 text-sm mt-0.5">{fmt.date(p.raceDate) + " · " + p.distanceKm + " km"}</p>
                    <p className="text-amber-200/80 text-xs mt-1">This race has passed — add your time to keep the record.</p>
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => setLogFor(p.editionId)}
                        className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-xl text-sm font-semibold transition-colors">
                        Add your time
                      </button>
                      <button onClick={() => removePart(p.editionId)} aria-label="Remove"
                        className="flex items-center justify-center text-slate-400 hover:text-red-400 px-2 transition-colors">
                        <X size={16}/>
                      </button>
                    </div>
                    {logFor === p.editionId && <ResultForm joined={joined} onSave={saveResult} onCancel={() => setLogFor(null)}/>}
                  </div>
                );
              })}
            </Section>
          )}

          {done.length > 0 && (
            <Section title="Completed">
              {done.slice().sort((a, b) => b.raceDate.localeCompare(a.raceDate)).map(p => (
                <div key={p.editionId} className="bg-slate-800 rounded-xl p-4">
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{p.label}</p>
                      <p className="text-slate-400 text-sm mt-0.5">{fmt.date(p.raceDate) + " · " + p.distanceKm + " km"}</p>
                      {p.notes && <p className="text-slate-400 text-xs mt-1 truncate">{p.notes}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-lg font-bold text-emerald-400 leading-none">{p.timeSec ? fmt.dur(p.timeSec) : "—"}</p>
                      {isPersonalBest(p, parts) && <span className="inline-flex items-center gap-0.5 text-xs text-amber-300 mt-1 font-semibold"><Star size={11}/>PB</span>}
                    </div>
                  </div>
                  <button onClick={() => removePart(p.editionId)}
                    className="text-xs text-slate-500 hover:text-red-400 mt-2 transition-colors">Remove</button>
                </div>
              ))}
            </Section>
          )}
        </div>
      )}

      {seg === "browse" && (
        <div>
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search races, cities…"
              className={INPUT_CLS + " pl-9"}/>
          </div>
          <div className="space-y-2">
            {filterRaces(CURATED_RACES, query).map(race => {
              const open = expanded === race.id;
              return (
                <div key={race.id} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                  <button onClick={() => setExpanded(open ? null : race.id)} className="w-full px-4 py-3 flex items-center gap-2 text-left">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{race.name}</p>
                      <p className="text-slate-400 text-xs">{[race.city, race.country].filter(Boolean).join(", ") + " · " + race.distances.join("/") + " km"}</p>
                    </div>
                    <ChevronRight size={16} className={"text-slate-600 transition-transform flex-shrink-0 " + (open ? "rotate-90" : "")}/>
                  </button>
                  {open && (
                    <div className="border-t border-slate-700/50 px-4 py-3 space-y-3">
                      <a href={race.url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300">
                        Official site<ExternalLink size={11}/>
                      </a>
                      <p className="text-[11px] text-slate-500">Dates are curated — always verify on the official site before planning.</p>
                      {race.editions.map(e => {
                        const joined = { ...race, editions: undefined, raceId: race.id, edition: e };
                        const part = byId[e.id];
                        return (
                          <div key={e.id} className="flex items-center gap-2 border-t border-slate-700/30 pt-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm">{fmt.date(e.date)}</p>
                              <p className="text-xs text-slate-500">{e.distanceKm + " km" + (e.elevation ? " · +" + e.elevation + "m" : "")}</p>
                            </div>
                            {part ? (
                              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1 px-2">
                                <Check size={13}/>{part.status === "done" ? "Done" : "On your list"}
                              </span>
                            ) : (
                              <>
                                <button onClick={() => addWishlist(joined)}
                                  className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 transition-colors">
                                  <Star size={12}/>Wishlist
                                </button>
                                <button onClick={() => setLogFor(e.id)}
                                  className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors">
                                  <Flag size={12}/>Done
                                </button>
                              </>
                            )}
                            {logFor === e.id && <div className="w-full"><ResultForm joined={joined} onSave={saveResult} onCancel={() => setLogFor(null)}/></div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-slate-500 text-xs text-center mt-5">
            Can't find a race? Adding your own — visible to everyone — is coming soon.
          </p>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <p className="text-slate-400 text-xs uppercase tracking-widest mb-2">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// Inline finish-time form for marking a race done. Defaults to also adding a
// RACE run to the log so the result flows into History/Stats/predictions.
function ResultForm({ joined, onSave, onCancel }) {
  const [h, setH] = useState("");
  const [m, setM] = useState("");
  const [s, setS] = useState("");
  const [notes, setNotes] = useState("");
  const [alsoLog, setAlsoLog] = useState(true);

  const submit = () => {
    const sec = (parseInt(h) || 0) * 3600 + (parseInt(m) || 0) * 60 + (parseInt(s) || 0);
    if (!sec) return;
    onSave(joined, sec, notes, alsoLog);
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-3 w-full">
      <div>
        <label className={LABEL_CLS}>Finish time</label>
        <div className="grid grid-cols-3 gap-2">
          <input type="number" min="0" max="59" placeholder="h" value={h} onChange={e => setH(e.target.value)} className={INPUT_CLS}/>
          <input type="number" min="0" max="59" placeholder="min" value={m} onChange={e => setM(e.target.value)} className={INPUT_CLS}/>
          <input type="number" min="0" max="59" placeholder="sec" value={s} onChange={e => setS(e.target.value)} className={INPUT_CLS}/>
        </div>
      </div>
      <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" className={INPUT_CLS}/>
      <label className="flex items-center gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={alsoLog} onChange={e => setAlsoLog(e.target.checked)} className="accent-orange-500"/>
        Also add to my run log
      </label>
      <div className="flex gap-2">
        <button onClick={submit}
          className="flex-1 flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-xl text-sm font-semibold transition-colors">
          <Plus size={14}/>Save result
        </button>
        <button onClick={onCancel} className="px-3 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
      </div>
    </div>
  );
}

// ── small helpers ─────────────────────────────────────────────────────────────
function daysUntil(dateStr, today) {
  return Math.ceil((new Date(dateStr + "T00:00:00") - today) / 86400000);
}
function filterRaces(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(r => (r.name + " " + r.city + " " + r.country).toLowerCase().includes(q));
}
