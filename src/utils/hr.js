// Heart-rate zone definitions and bpm calculations, shared by the HR Zones
// settings screen and the per-session targets on the plan.

export const HR_ZONES = [
  {n:1,name:"Recovery",     lo:0.50,hi:0.60,clr:"#60a5fa",type:"Aerobic",   desc:"Very easy — active recovery, warm-up/cool-down"},
  {n:2,name:"Aerobic Base", lo:0.60,hi:0.70,clr:"#34d399",type:"Aerobic",   desc:"Easy runs, fat burning, building endurance base"},
  {n:3,name:"Aerobic Tempo",lo:0.70,hi:0.80,clr:"#facc15",type:"Aerobic",   desc:"Moderate effort — marathon and long-run pace"},
  {n:4,name:"Threshold",    lo:0.80,hi:0.90,clr:"#fb923c",type:"Anaerobic", desc:"Comfortably hard — lactate threshold, tempo runs"},
  {n:5,name:"VO2 Max",      lo:0.90,hi:1.00,clr:"#f87171",type:"Anaerobic", desc:"Maximum effort — short intervals, race pace"},
];

// Each session type maps onto one (or a span of) HR_ZONES — the bpm range shown
// is derived from those zones' percentages via hrZoneBpm.
export const SESSION_ZONES = {
  EASY:      {zones:[2],   label:"Z2 · Aerobic Base",        clr:"#34d399"},
  LONG:      {zones:[2],   label:"Z2 · Aerobic Base",        clr:"#34d399"},
  TEMPO:     {zones:[3,4], label:"Z3-4 · Lactate Threshold", clr:"#fb923c"},
  INTERVALS: {zones:[4,5], label:"Z4-5 · Max effort (reps)", clr:"#f87171"},
  RACE:      {zones:[3,4], label:"Z3-4 · Race effort",       clr:"#fb923c"},
  WALK:      {zones:[1],   label:"Z1 · Recovery",            clr:"#60a5fa"},
};

// Compute the bpm range for a zone using the Karvonen (heart-rate reserve)
// method — it accounts for resting HR, so it's more accurate than plain % of
// MaxHR.
export function hrZoneBpm(loPct, hiPct, maxHR, restHR) {
  if (!maxHR) return null;
  const hrr = maxHR - restHR;
  if (hrr <= 0) return null;
  return {lo: Math.round(hrr * loPct + restHR), hi: Math.round(hrr * hiPct + restHR)};
}

// Classify an average HR into its zone number (1..5) for the given profile,
// or null if it can't be computed. Last zone is open-ended at the top.
export function runZoneIndex(hr, maxHR, restHR) {
  if (!hr || !maxHR) return null;
  const idx = HR_ZONES.findIndex((z, i) => {
    const r = hrZoneBpm(z.lo, z.hi, maxHR, restHR);
    if (!r) return false;
    return i === HR_ZONES.length - 1 ? hr >= r.lo : hr >= r.lo && hr < r.hi;
  });
  return idx >= 0 ? idx + 1 : null;
}

// Resolve a session type's target bpm range from settings.
export function sessionHR(type, settings) {
  const cfg    = SESSION_ZONES[type] || SESSION_ZONES.EASY;
  const loZone = HR_ZONES[cfg.zones[0] - 1];
  const hiZone = HR_ZONES[cfg.zones[cfg.zones.length - 1] - 1];
  const r = hrZoneBpm(loZone.lo, hiZone.hi, settings.maxHR || 0, settings.restHR || 60);
  if (!r) return null;
  return {lo:r.lo, hi:r.hi, label:cfg.label, clr:cfg.clr};
}
