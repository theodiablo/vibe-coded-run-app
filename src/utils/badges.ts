// Badge computation — pure, derived from existing data (runs, plan,
// participations). Simple locked/unlocked. Tone is deliberately gentle &
// inclusive for a fitness app: consistency is *cumulative* (count of active
// weeks), never a fragile "don't break the chain" streak, and WALK runs count
// toward distance/volume/consistency just like runs.
//
// Each badge exposes a `progress` (0..1) and, for locked ones, a short `hint`
// ("8 km to go") so the Dashboard can show a "next badge" teaser. Icons are
// stored as lucide *names* (strings) and mapped in Badge.jsx, keeping this file
// React-free and unit-testable.

import { ymd } from "./format";

const clamp01 = x => Math.max(0, Math.min(1, x));

// Monday (local) of a run's week, as YYYY-MM-DD — for counting active weeks.
const weekKey = dateStr => {
  const d = new Date(dateStr + "T00:00:00");
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(mon);
};

const km1 = n => (n % 1 === 0 ? n : Math.round(n * 10) / 10);

// A milestone badge: unlocked once `value >= threshold`. `unit`/`noun` shape the
// remaining-amount hint.
function milestone(id, label, Icon, value, threshold, unit, noun) {
  const unlocked = value >= threshold;
  const remaining = Math.max(0, threshold - value);
  return {
    id, label, Icon, unlocked,
    progress: clamp01(value / threshold),
    desc: noun,
    hint: unlocked ? null : km1(remaining) + unit + " to go",
  };
}

export function computeBadges(runs = [], participations = []) {
  const maxKm = runs.reduce((m, r) => Math.max(m, r.km || 0), 0);
  const totalKm = runs.reduce((s, r) => s + (r.km || 0), 0);
  const totalElev = runs.reduce((s, r) => s + (r.elevation || 0), 0);
  const activeWeeks = new Set(runs.filter(r => r.date).map(r => weekKey(r.date))).size;
  const hasGps = runs.some(r => r.source === "gps");
  const wishlisted = participations.length;
  const doneRaces = participations.filter(p => p.status === "done").length;

  return [
    // ── Distance milestones (single longest run; walking counts) ────────────
    milestone("dist-first-5k", "First 5K", "Footprints", maxKm, 5, " km", "Run 5 km in one outing"),
    milestone("dist-first-10k", "First 10K", "Footprints", maxKm, 10, " km", "Run 10 km in one outing"),
    milestone("dist-first-half", "Half Marathon", "Medal", maxKm, 21, " km", "Cover a half marathon"),
    milestone("dist-first-marathon", "Marathon", "Trophy", maxKm, 42, " km", "Go the full marathon distance"),

    // ── Volume (lifetime distance) ──────────────────────────────────────────
    milestone("vol-100", "100 km club", "Gauge", totalKm, 100, " km", "100 km logged all-time"),
    milestone("vol-500", "500 km club", "Gauge", totalKm, 500, " km", "500 km logged all-time"),
    milestone("vol-1000", "1000 km club", "Gauge", totalKm, 1000, " km", "1000 km logged all-time"),

    // ── Consistency (cumulative active weeks — forgiving, not a streak) ──────
    milestone("weeks-4", "Getting going", "CalendarCheck", activeWeeks, 4, " wk", "Run in 4 different weeks"),
    milestone("weeks-12", "In the habit", "CalendarCheck", activeWeeks, 12, " wk", "Run in 12 different weeks"),
    milestone("weeks-26", "Half a year strong", "CalendarHeart", activeWeeks, 26, " wk", "Run in 26 different weeks"),

    // ── Races ───────────────────────────────────────────────────────────────
    milestone("race-wishlist", "Dreaming big", "Star", wishlisted, 1, "", "Add a race to your list"),
    milestone("race-done-1", "First finish line", "Flag", doneRaces, 1, "", "Complete your first race"),
    milestone("race-done-5", "Seasoned racer", "Flag", doneRaces, 5, "", "Complete 5 races"),

    // ── Exploration ─────────────────────────────────────────────────────────
    { id: "gps-first", label: "On the map", Icon: "MapPin", unlocked: hasGps,
      progress: hasGps ? 1 : 0, desc: "Track a run with GPS",
      hint: hasGps ? null : "Track a run with GPS" },
    milestone("elev-1000", "Climber", "Mountain", totalElev, 1000, " m", "Climb 1000 m all-time"),
    milestone("elev-5000", "Mountain goat", "Mountain", totalElev, 5000, " m", "Climb 5000 m all-time"),
  ];
}

// The locked badge closest to completion (for the Dashboard teaser). Prefers
// ones with real progress so we don't tease a 0% far-off badge. Returns null
// when everything's unlocked.
export function nextBadge(badges = []) {
  const locked = badges.filter(b => !b.unlocked);
  if (!locked.length) return null;
  return locked.slice().sort((a, b) => b.progress - a.progress)[0];
}

// Ids of every currently-unlocked badge — used to seed `seenBadges` silently on
// first run and to diff for new-unlock toasts thereafter.
export function unlockedIds(badges = []) {
  return badges.filter(b => b.unlocked).map(b => b.id);
}
