import { parseRunsCsv } from "../../utils/csv";
import { parseActivityFile } from "../../utils/gpx";
import type { ImportProvider, ImportParseResult } from "../types";

// Activity-file import: the universal path that needs no vendor cooperation and
// works on web too. CSV (Zepp / Strava account exports — the pre-existing flow,
// unchanged underneath) yields many runs without traces; GPX/TCX (one activity
// per file, exported from Garmin Connect / Strava / most platforms) yields one
// run WITH its route points, which the caller persists via saveRoute.
//
// Note: importing a user's own Strava CSV/GPX export is their GDPR
// data-portability right — unrelated to the Strava *API*, which we deliberately
// don't use (its agreement bans AI-model use of API data; the coach reads runs).
function ext(name: string): string {
  const i = (name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export const fileProvider: ImportProvider = {
  id: "file",
  label: "Activity file (CSV, GPX, TCX)",
  kind: "file",
  platform: "both",
  isAvailable: () => true,
  fileAccept: ".csv,.gpx,.tcx",
  parse: ({ name, text }): ImportParseResult => {
    const e = ext(name);
    if (e === "gpx" || e === "tcx") {
      const res = parseActivityFile(text, e);
      return res.run ? { runs: [res.run] } : { runs: [], error: res.error };
    }
    if (e === "csv") {
      const { runs, error } = parseRunsCsv(text);
      return { runs, error };
    }
    return { runs: [], error: "Unsupported file type — use a CSV, GPX or TCX export." };
  },
  help:
    "Export a single activity as GPX/TCX (includes the route map), or your whole " +
    "history as CSV from Zepp or Strava.",
};
