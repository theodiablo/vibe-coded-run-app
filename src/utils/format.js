// Formatting / date helpers shared across views.

export const p2 = n => String(n).padStart(2, "0");

export const fmt = {
  pace: s => (!s || s <= 0) ? "--:--" : Math.floor(s/60) + ":" + p2(Math.round(s%60)),
  dur: s => {
    if (!s) return "--";
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sc = Math.round(s%60);
    return h ? (h + ":" + p2(m) + ":" + p2(sc)) : (m + ":" + p2(sc));
  },
  date: s => s ? new Date(s+"T12:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "",
  sht:  s => s ? new Date(s+"T12:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"}) : "",
  // A whole-minute duration as a compact label: 30min, 1h, 1h15, 1h50. Avoids
  // the raw-float "1.8333333333333335h" you get from a bare `minutes / 60`.
  mins: m => {
    if (m == null || m === "") return "";
    if (m < 60) return m + "min";
    const h = Math.floor(m / 60), r = Math.round(m % 60);
    return r ? h + "h" + p2(r) : h + "h";
  },
};

// Parse a colon-separated time string into seconds — accepts a goal time
// ("m:ss" / "h:mm:ss") or a pace ("m:ss" per km). Each segment carries over at
// 60, so it round-trips with fmt.dur / fmt.pace. Returns null for blank or
// non-numeric input so callers can ignore an incomplete edit rather than
// snapping the value to 0.
export const parseDur = str => {
  const t = (str ?? "").trim();
  if (!t) return null;
  const parts = t.split(":");
  if (parts.some(p => p.trim() === "" || isNaN(Number(p)))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
};

// Local YYYY-MM-DD. Using toISOString() here would convert to UTC and shift the
// calendar day for anyone east of GMT (e.g. a Monday at local midnight becomes
// the Sunday before), so we read the date parts in local time instead.
export const ymd = d => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());

// Estimated session duration (rounded minutes) for the prescribed distance/pace.
export const estMin = (km, pace) => (km && pace) ? Math.round(km * pace / 60) + " min" : "";

// Strip any stale "· N min" slot label baked into older stored descriptions —
// the real estimate is shown alongside km/pace instead.
export const cleanDesc = d => (d || "").replace(/\s*·\s*~?\d+\s*min\s*$/, "");
