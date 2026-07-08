import { useState } from "react";
import { Search, Star, Flag, Target, ExternalLink, X, Check, Plus, Trophy, ChevronRight, Navigation, AlertTriangle, Loader } from "lucide-react";
import { INPUT_CLS, LABEL_CLS } from "../constants";
import { track } from "../telemetry";
import { fmt, ymd } from "../utils/format";
import { findEdition, editionLabel, isPersonalBest } from "../utils/races";
import { AddRaceCard } from "../components/AddRaceCard";
import { haversineM } from "../utils/geo";
import { geoSource } from "../geo/source";
import { reportRace } from "../races";

const SEGMENTS = [["mine", "My Races"], ["find", "Find a race"]];
// Find-a-race filter chips: event distance bands (km) and "near me" radius (km).
const BANDS = [5, 10, 21.1, 42.2];
const RADII = [25, 50, 100, 500];

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

// Amber "this is user-submitted" tag for any unverified race/edition.
function UnverifiedTag() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded-md">
      <AlertTriangle size={10}/>unverified — verify on official site
    </span>
  );
}

export function RacesView({ races, saveRaces, settings, promoteEdition, setRaceInPlan, addRuns, showToast, catalogue, openRaceForm }) {
  const [seg, setSeg] = useState("mine");
  const [logFor, setLogFor] = useState(null); // editionId being logged

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = ymd(today);
  const parts = races?.participations || [];
  const byId = Object.fromEntries(parts.map(p => [p.editionId, p]));
  const cat = catalogue || [];

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
              <button onClick={() => setSeg("find")}
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
                        <p className="font-semibold line-clamp-2 leading-snug">{p.label}</p>
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
                      <p className="font-semibold line-clamp-2 leading-snug">{p.label}</p>
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

      {seg === "find" && (
        <FindPanel catalogue={cat} byId={byId} addWishlist={addWishlist}
          logFor={logFor} setLogFor={setLogFor} saveResult={saveResult}
          showToast={showToast} openRaceForm={openRaceForm}/>
      )}
    </div>
  );
}

// ── Find a race (text search + optional "near me" sort) ──────────────────────
// One catalogue list, grouped by race. Text search + event-distance bands
// always apply; the "Near me" toggle layers on a one-off geolocation sort
// (distance shown as "X km away"). Races without coordinates fall into a
// "Location unknown" bucket while Near me is on rather than disappearing.
function FindPanel({ catalogue, byId, addWishlist, logFor, setLogFor, saveResult, showToast, openRaceForm }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(null); // raceId expanded
  const [reportFor, setReportFor] = useState(null); // raceId being reported
  const [band, setBand] = useState(null);          // event distance band (km) or null
  const [nearMe, setNearMe] = useState(false);
  const [radius, setRadius] = useState(100);        // km
  const [loc, setLoc] = useState(null);
  const [status, setStatus] = useState("idle");     // idle | locating | denied

  const toggleNearMe = async () => {
    if (nearMe) { setNearMe(false); return; }
    if (loc) { setNearMe(true); return; }           // reuse an earlier fix
    setStatus("locating");
    try {
      const p = await geoSource.getCurrentPosition();
      setLoc(p); setNearMe(true); setStatus("idle");
      track("find_near_me");
    } catch {
      setStatus("denied");
    }
  };

  // Text + band narrow the catalogue; a race passes the band if any of its
  // editions falls in it.
  const matchesBand = race => band == null || (race.editions || []).some(e => Math.abs(e.distanceKm - band) <= band * 0.12);
  const base = filterRaces(catalogue, query).filter(matchesBand);

  // With Near me on, split into distance-sorted (within radius) + a
  // location-unknown bucket; races with coordinates beyond the radius drop out.
  let located;
  const unlocated = [];
  if (nearMe && loc) {
    const withCoord = [];
    for (const race of base) {
      if (race.lat == null || race.lng == null) { unlocated.push(race); continue; }
      const distM = haversineM(loc, { lat: race.lat, lng: race.lng });
      if (distM > radius * 1000) continue;
      withCoord.push({ race, distM });
    }
    withCoord.sort((a, b) => a.distM - b.distM);
    located = withCoord;
  } else {
    located = base.map(race => ({ race, distM: null }));
  }

  const cardProps = { byId, addWishlist, logFor, setLogFor, saveResult, reportFor, setReportFor, showToast };
  const nothing = located.length === 0 && unlocated.length === 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search races, cities…"
            className={INPUT_CLS + " pl-9"}/>
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-[11px] text-slate-500 mr-1">Distance</span>
          <Chip active={band == null} onClick={() => setBand(null)}>All</Chip>
          {BANDS.map(b => <Chip key={b} active={band === b} onClick={() => setBand(band === b ? null : b)}>{b} km</Chip>)}
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          <button onClick={toggleNearMe} disabled={status === "locating"}
            className={"inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors border disabled:opacity-60 " +
              (nearMe ? "bg-orange-500 text-white border-orange-500" : "bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-500")}>
            {status === "locating" ? <Loader size={13} className="animate-spin"/> : <Navigation size={13}/>}
            Near me
          </button>
          {nearMe && <span className="text-[11px] text-slate-500 mx-1">within</span>}
          {nearMe && RADII.map(r => <Chip key={r} active={radius === r} onClick={() => setRadius(r)}>{r} km</Chip>)}
        </div>
        {status === "denied" && (
          <p className="text-xs text-red-400">Location unavailable or denied — showing all races by name.</p>
        )}
      </div>

      {!catalogue.length ? (
        <div className="bg-slate-800 rounded-2xl p-6 text-center text-sm text-slate-400">
          The race catalogue couldn't be loaded right now. Your own races are still listed under My Races.
        </div>
      ) : nothing ? (
        <div className="bg-slate-800 rounded-2xl p-6 text-center text-sm text-slate-400">
          {nearMe ? "No races within " + radius + " km. Try a wider radius or turn off Near me." : "No races match — try a different search."}
        </div>
      ) : (
        <>
          {nearMe && located.length === 0 && unlocated.length > 0 && (
            <p className="text-xs text-slate-500">No races within {radius} km. Races without a set location are listed below.</p>
          )}
          <div className="space-y-2">
            {located.map(({ race, distM }) => (
              <RaceCard key={race.id} race={race} distM={distM}
                open={expanded === race.id} onToggle={() => setExpanded(expanded === race.id ? null : race.id)}
                {...cardProps}/>
            ))}
          </div>
          {unlocated.length > 0 && (
            <div>
              <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-4 mb-2">Location unknown</p>
              <div className="space-y-2">
                {unlocated.map(race => (
                  <RaceCard key={race.id} race={race} distM={null}
                    open={expanded === race.id} onToggle={() => setExpanded(expanded === race.id ? null : race.id)}
                    {...cardProps}/>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="mt-6">
        <AddRaceCard onClick={openRaceForm} subtitle="Add it — instantly visible to everyone.">
          <p className="text-slate-500 text-[11px] px-1">
            Races are user-submitted and tagged unverified until a maintainer reviews them.
          </p>
        </AddRaceCard>
      </div>
    </div>
  );
}

// A single catalogue race, grouped: collapsed header (name, place, distances,
// optional "X km away", unverified flag) expanding to its editions, official
// site link, and a report affordance.
function RaceCard({ race, distM, open, onToggle, byId, addWishlist, logFor, setLogFor, saveResult, reportFor, setReportFor, showToast }) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <button onClick={onToggle} className="w-full px-4 py-3 flex items-center gap-2 text-left">
        <div className="flex-1 min-w-0">
          <p className="font-semibold leading-snug line-clamp-2">{race.name}</p>
          <p className="text-slate-400 text-xs">{[race.city, race.country].filter(Boolean).join(", ") + " · " + (race.distances || []).join(" km & ") + " km"}</p>
        </div>
        {distM != null && (
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-bold text-orange-400 leading-none">{fmtKm(distM)}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">away</p>
          </div>
        )}
        {!race.verified && (
          <span title="Unverified — details are user-submitted, check the official site" className="flex-shrink-0">
            <AlertTriangle size={13} className="text-amber-400"/>
          </span>
        )}
        <ChevronRight size={16} className={"text-slate-600 transition-transform flex-shrink-0 " + (open ? "rotate-90" : "")}/>
      </button>
      {open && (
        <div className="border-t border-slate-700/50 px-4 py-3 space-y-3">
          {!race.verified && <UnverifiedTag/>}
          {race.url && (
            <a href={race.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300">
              Official site<ExternalLink size={11}/>
            </a>
          )}
          <p className="text-[11px] text-slate-500">Dates are user-submitted — always verify on the official site before planning.</p>
          {race.editions.map(e => {
            const joined = { ...race, editions: undefined, raceId: race.id, edition: e };
            const part = byId[e.id];
            return (
              <div key={e.id} className="flex items-center gap-2 border-t border-slate-700/30 pt-3 flex-wrap">
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
          <div className="border-t border-slate-700/30 pt-3">
            {reportFor === race.id ? (
              <ReportForm onSubmit={(reason, note) => {
                reportRace({ raceSlug: race.slug || race.id, reason, note }).catch(() => {});
                setReportFor(null);
                showToast("Thanks — reported for review.");
              }} onCancel={() => setReportFor(null)}/>
            ) : (
              <button onClick={() => setReportFor(race.id)}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-400 transition-colors">
                <AlertTriangle size={11}/>Report this race
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={"px-3 py-1 rounded-full text-xs font-semibold transition-colors border " +
        (active ? "bg-orange-500 text-white border-orange-500" : "bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-500")}>
      {children}
    </button>
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

// Inline "report this race" form → race_reports + maintainer notification.
const REPORT_REASONS = ["Wrong date", "Wrong distance / details", "Duplicate", "Doesn't exist / spam", "Other"];
function ReportForm({ onSubmit, onCancel }) {
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <label className={LABEL_CLS}>Report a problem</label>
      <select value={reason} onChange={e => setReason(e.target.value)} className={INPUT_CLS}>
        {REPORT_REASONS.map(r => <option key={r}>{r}</option>)}
      </select>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Anything to add? (optional)" className={INPUT_CLS}/>
      <div className="flex gap-2">
        <button onClick={() => onSubmit(reason, note)}
          className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-xl text-sm font-semibold transition-colors">
          Send report
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
  return list.filter(r => (r.name + " " + (r.city || "") + " " + (r.country || "")).toLowerCase().includes(q));
}
function fmtKm(distM) {
  const km = distM / 1000;
  // Right on top of it (e.g. same city centroid) reads as a broken "0.0 km".
  if (km < 0.1) return "< 100 m";
  return km < 10 ? km.toFixed(1) + " km" : Math.round(km) + " km";
}
