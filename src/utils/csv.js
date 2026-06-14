// CSV import for Zepp / Strava activity exports.
//
// This is deliberately a small, dependency-free parser tuned for the two known
// export formats — not a full RFC-4180 implementation. It handles simple
// double-quoted fields (so a quoted value containing a comma is not split), but
// does not support escaped quotes or embedded newlines inside fields. Personal
// Zepp/Strava exports don't use those, and keeping it tiny avoids pulling in a
// parser dependency. All numeric fields are validated; rows that don't parse to
// sane values are skipped rather than silently coerced to 0.
import { ymd } from "./format";

// Guard against pathologically large uploads (memory / DOM blow-up).
export const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 MB

// Split a single CSV line, respecting simple double-quoted fields.
function splitCsvLine(line) {
  const out = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === "," && !inQuotes) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(v => v.trim());
}

// Parse a non-negative finite number, or return null when absent/invalid.
function num(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Parse raw CSV text into run objects. Returns { runs, error }.
export function parseRunsCsv(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return {runs: [], error: "Empty file."};

  const lines = trimmed.split(/\r?\n/);
  const hdrs  = splitCsvLine(lines[0]).map(h => h.replace(/"/g, "").toLowerCase());
  // Detect by each format's distinctive headers. Strava also has an
  // "activity type" column, so keying Zepp off that (as an earlier version did)
  // misrouted Strava exports into the Zepp branch and imported nothing — hence
  // the explicit "start time" / "distance (m)" markers for Zepp here.
  const isZepp   = hdrs.includes("start time") || hdrs.includes("distance (m)");
  const isStrava = !isZepp && (hdrs.includes("activity date") || hdrs.includes("elapsed time"));
  if (!isZepp && !isStrava) {
    return {runs: [], error: "No runs found. Check it's a Zepp or Strava CSV."};
  }

  const runs = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitCsvLine(lines[i]);
    const row  = {};
    hdrs.forEach((h, j) => { row[h] = vals[j] != null ? vals[j] : ""; });

    if (isZepp) {
      const dStr = (row["start time"] || "").split(" ")[0];
      const dM   = num(row["distance (m)"] ?? row["distance"]);
      const dur  = num(row["duration (s)"] ?? row["duration"]);
      if (dM != null && dur != null && dM > 500 && dur > 60) {
        runs.push({
          date: dStr || ymd(new Date()),
          type: "EASY", km: Math.round(dM / 100) / 10, durationSec: Math.round(dur),
          hr:    num(row["average heart rate (bpm)"]),
          hrMax: num(row["max heart rate (bpm)"]),
          elevation: null, effort: 5, notes: "Zepp import",
        });
      }
    } else {
      const dStr = row["activity date"] ? ymd(new Date(row["activity date"])) : "";
      const dK   = num(row["distance"]);
      const dur  = num(row["elapsed time"] ?? row["moving time"]);
      const aT   = (row["activity type"] || "run").toLowerCase();
      if (aT.includes("run") && dK != null && dK > 0.5) {
        runs.push({
          date: dStr, type: "EASY", km: dK, durationSec: dur != null ? Math.round(dur) : 0,
          hr:    num(row["average heart rate"]),
          hrMax: num(row["max heart rate"]),
          elevation: num(row["elevation gain"]),
          effort: 5, notes: "Strava import",
        });
      }
    }
  }
  return {runs, error: runs.length ? null : "No runs found. Check it's a Zepp or Strava CSV."};
}
