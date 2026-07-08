// Geo helpers for live GPS run tracking.
//
// A "point" is the stored tuple [lat, lng, tEpochMs, altMeters|null]. A `null`
// entry in a point array is a GAP MARKER — it breaks the track where GPS was
// lost (signal drop, tab backgrounded) so we don't draw a straight line across
// ground that wasn't run. All functions below treat null as a break and accept
// either a tuple or a plain {lat,lng} where only the coordinate matters, so
// they're easy to unit-test.

const R = 6371000; // Earth's mean radius, metres
export type StoredTrackPoint = readonly [number, number, number, number | null];
export type TrackPoint = readonly (number | null)[];
export type TrackPointOrGap = TrackPoint | null;
type Coord = { lat: number; lng: number; alt?: number | null };

const rad = (d: number) => (d * Math.PI) / 180;
const isArrayPoint = (p: TrackPoint | Coord): p is TrackPoint => Array.isArray(p);
const coord = (p: TrackPoint | Coord): Coord => (isArrayPoint(p) ? { lat: Number(p[0]), lng: Number(p[1]) } : p);

// Great-circle (haversine) distance between two points, in metres.
export function haversineM(a: TrackPoint | Coord, b: TrackPoint | Coord) {
  const p = coord(a), q = coord(b);
  const dLat = rad(q.lat - p.lat), dLng = rad(q.lng - p.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(p.lat)) * Math.cos(rad(q.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Total distance (km) along a point array. Legs shorter than `minM` are treated
// as GPS jitter and skipped, so a near-stationary runner doesn't accumulate
// phantom distance. Gap markers (null) are bridged with the straight-line
// distance to the next real fix: that geodesic is the *minimum* the runner could
// have covered between the two fixes, so counting it gets closer to the truth
// than dropping the stretch — and can't overestimate.
export function distanceKm(points: TrackPointOrGap[], minM = 3) {
  let m = 0, prev: TrackPoint | null = null;
  for (const p of points) {
    if (!p) continue; // gap marker: bridge to the next real fix
    if (prev) {
      const d = haversineM(prev, p);
      if (d >= minM) m += d;
    }
    prev = p;
  }
  return m / 1000;
}

// Cumulative positive elevation gain (metres). Counts only ascents above `minM`
// (hysteresis band that filters GPS/barometric noise) and ignores points whose
// altitude is null — many phones don't report it. Gap markers reset the band.
// GPS vertical error is ~2-3x the horizontal and phones quantise altitude to
// whole metres, so a small band (e.g. 1m) lets every noise wiggle through and a
// flat run accumulates phantom climb — keep the band at ~5m, the usual floor for
// GPS-only (barometer-less) elevation.
export function elevGainM(points: (TrackPointOrGap | Coord)[], minM = 5) {
  let gain = 0, prev: number | null = null;
  for (const p of points) {
    if (!p) { prev = null; continue; }
    const alt = isArrayPoint(p) ? p[3] : p.alt;
    if (alt == null) continue;
    if (prev != null) {
      const diff = alt - prev;
      if (diff >= minM) { gain += diff; prev = alt; }
      else if (diff <= -minM) { prev = alt; }
      // within the noise band: keep prev (hysteresis)
    } else {
      prev = alt;
    }
  }
  return gain;
}

// Perpendicular distance (metres) from point `pt` to segment a→b, using a local
// equirectangular projection scaled to metres (accurate enough at run scale).
function perpM(pt: TrackPoint, a: TrackPoint, b: TrackPoint) {
  const lat0 = rad(Number(a[0]));
  const toXY = (p: TrackPoint): [number, number] => [rad(Number(p[1])) * Math.cos(lat0) * R, rad(Number(p[0])) * R];
  const [px, py] = toXY(pt), [ax, ay] = toXY(a), [bx, by] = toXY(b);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Douglas–Peucker simplification of a single gap-free segment.
function simplifyOne(seg: TrackPoint[], epsilonM: number): TrackPoint[] {
  if (seg.length <= 2) return seg.slice();
  const a = seg[0], b = seg[seg.length - 1];
  let idx = 0, max = 0;
  for (let i = 1; i < seg.length - 1; i++) {
    const d = perpM(seg[i], a, b);
    if (d > max) { max = d; idx = i; }
  }
  if (max > epsilonM) {
    const left = simplifyOne(seg.slice(0, idx + 1), epsilonM);
    const right = simplifyOne(seg.slice(idx), epsilonM);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

// Simplify a point array for storage, preserving gap markers between segments.
export function simplify(points: TrackPointOrGap[], epsilonM = 5): TrackPointOrGap[] {
  const segs: TrackPoint[][] = [];
  let cur: TrackPoint[] = [];
  for (const p of points) {
    if (!p) { if (cur.length) { segs.push(cur); cur = []; } }
    else cur.push(p);
  }
  if (cur.length) segs.push(cur);
  const out: TrackPointOrGap[] = [];
  segs.forEach((seg, i) => {
    if (i) out.push(null);
    out.push(...simplifyOne(seg, epsilonM));
  });
  return out;
}

// Split a point array into gap-free segments of [lat,lng] pairs — what Leaflet's
// L.polyline wants (one polyline per segment so gaps aren't bridged).
export function segments(points: TrackPointOrGap[]): [number, number][][] {
  const segs: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (const p of points) {
    if (!p) { if (cur.length) { segs.push(cur); cur = []; } }
    else cur.push([Number(p[0]), Number(p[1])]);
  }
  if (cur.length) segs.push(cur);
  return segs;
}

// Whether a GeolocationPosition is accurate enough to keep (metres). A missing
// accuracy reading is accepted rather than dropped.
export function accuracyOK(pos: { coords?: { accuracy?: number | null } } | null | undefined, maxM = 35) {
  const acc = pos?.coords?.accuracy;
  return acc == null || acc <= maxM;
}
