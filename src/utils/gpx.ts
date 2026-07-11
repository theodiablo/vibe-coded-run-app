// GPX / TCX activity-file parsing for the file import provider.
//
// Small and dependency-free like csv.ts: DOMParser (browser + jsdom) over the
// two well-known schemas. GPX: <trkpt lat lon><ele/><time/> plus the Garmin
// TrackPointExtension heart rate (any-namespace <hr>). TCX: <Trackpoint> with
// <Time>, <Position>, <AltitudeMeters>, <HeartRateBpm><Value>. One file = one
// activity; distance/elevation are derived from the trace with the same geo
// math as live GPS runs, so an imported map and its stats agree.
import { distanceKm, elevGainM, type TrackPointOrGap } from "./geo";
import { hrSummary } from "./hr";
import type { ImportedRun } from "../imports/types";

export const MAX_GPX_BYTES = 20 * 1024 * 1024; // 20 MB — GPX is verbose

type ParseOk = { run: ImportedRun; error?: undefined };
type ParseErr = { run?: undefined; error: string };
export type ActivityParseResult = ParseOk | ParseErr;

const num = (v: string | null | undefined) => {
  if (v == null || v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const text = (el: Element, tag: string) => {
  const c = el.getElementsByTagName(tag)[0];
  return c?.textContent ?? null;
};

// First descendant whose local name matches, ignoring namespace prefixes —
// Garmin writes <ns3:hr>, other tools <gpxtpx:hr> or plain <hr>.
function localText(el: Element, local: string): string | null {
  for (const d of Array.from(el.getElementsByTagName("*"))) {
    if (d.localName === local || d.nodeName.toLowerCase().endsWith(":" + local)) return d.textContent;
  }
  return null;
}

function parseXml(input: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(input, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return null;
    return doc;
  } catch { return null; }
}

function ymdLocal(ms: number) {
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
}

// Reduce collected trackpoints + HR samples to an ImportedRun (with the trace
// attached as transient `points` for the caller to saveRoute).
function toRun(points: TrackPointOrGap[], hr: { bpm: number; t: number }[], label: string): ActivityParseResult {
  const times = points.filter((p): p is TrackPointOrGap & readonly number[] => !!p && p[2] != null).map(p => p![2] as number);
  if (!times.length) return { error: "No usable trackpoints found in that file." };
  const startMs = times[0], endMs = times[times.length - 1];
  const km = Math.round(distanceKm(points) * 100) / 100;
  if (km < 0.05) return { error: "That file has no distance — check it's a recorded activity." };
  const s = hrSummary(hr);
  const elevation = elevGainM(points);
  const run: ImportedRun = {
    date: ymdLocal(startMs),
    type: "EASY",
    km,
    durationSec: Math.max(1, Math.round((endMs - startMs) / 1000)),
    hr: s.hrAvg,
    hrMax: s.hrMax,
    effort: 5,
    notes: label,
    source: "file",
    startedAt: new Date(startMs).toISOString(),
    points,
  };
  if (elevation > 0) run.elevation = Math.round(elevation);
  return { run };
}

function parseGpx(doc: Document): ActivityParseResult {
  const pts: TrackPointOrGap[] = [];
  const hr: { bpm: number; t: number }[] = [];
  for (const el of Array.from(doc.getElementsByTagName("trkpt"))) {
    const lat = num(el.getAttribute("lat"));
    const lng = num(el.getAttribute("lon"));
    const t = Date.parse(text(el, "time") || "");
    if (lat == null || lng == null || !Number.isFinite(t)) continue;
    const alt = num(text(el, "ele"));
    pts.push([lat, lng, t, alt]);
    const bpm = num(localText(el, "hr"));
    if (bpm) hr.push({ bpm, t });
  }
  return toRun(pts, hr, "GPX import");
}

function parseTcx(doc: Document): ActivityParseResult {
  const pts: TrackPointOrGap[] = [];
  const hr: { bpm: number; t: number }[] = [];
  for (const el of Array.from(doc.getElementsByTagName("Trackpoint"))) {
    const t = Date.parse(text(el, "Time") || "");
    if (!Number.isFinite(t)) continue;
    const pos = el.getElementsByTagName("Position")[0];
    const lat = pos ? num(text(pos, "LatitudeDegrees")) : null;
    const lng = pos ? num(text(pos, "LongitudeDegrees")) : null;
    if (lat != null && lng != null) pts.push([lat, lng, t, num(text(el, "AltitudeMeters"))]);
    const bpmEl = el.getElementsByTagName("HeartRateBpm")[0];
    const bpm = bpmEl ? num(text(bpmEl, "Value")) : null;
    if (bpm) hr.push({ bpm, t });
  }
  return toRun(pts, hr, "TCX import");
}

// Parse a single GPX or TCX activity export. Returns { run } (with transient
// route `points`) or { error } — never throws.
export function parseActivityFile(input: string, kind: "gpx" | "tcx"): ActivityParseResult {
  const trimmed = (input || "").trim();
  if (!trimmed) return { error: "Empty file." };
  const doc = parseXml(trimmed);
  if (!doc) return { error: "Couldn't read that file — it doesn't look like valid " + kind.toUpperCase() + "." };
  return kind === "gpx" ? parseGpx(doc) : parseTcx(doc);
}
