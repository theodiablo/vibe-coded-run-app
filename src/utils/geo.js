// Geo helpers for live GPS run tracking.
//
// A "point" is the stored tuple [lat, lng, tEpochMs, altMeters|null]. A `null`
// entry in a point array is a GAP MARKER — it breaks the track where GPS was
// lost (signal drop, tab backgrounded) so we don't draw a straight line across
// ground that wasn't run. All functions below treat null as a break and accept
// either a tuple or a plain {lat,lng} where only the coordinate matters, so
// they're easy to unit-test.

const R = 6371000; // Earth's mean radius, metres
const rad = d => (d * Math.PI) / 180;
const coord = p => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : p);

// Great-circle (haversine) distance between two points, in metres.
export function haversineM(a, b) {
  const p = coord(a), q = coord(b);
  const dLat = rad(q.lat - p.lat), dLng = rad(q.lng - p.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(p.lat)) * Math.cos(rad(q.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Total distance (km) along a point array. Segments shorter than `minM` are
// treated as GPS jitter and skipped, so a near-stationary runner doesn't
// accumulate phantom distance. Gap markers break accumulation.
export function distanceKm(points, minM = 3) {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (!a || !b) continue;
    const d = haversineM(a, b);
    if (d >= minM) m += d;
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
export function elevGainM(points, minM = 5) {
  let gain = 0, prev = null;
  for (const p of points) {
    if (!p) { prev = null; continue; }
    const alt = Array.isArray(p) ? p[3] : p.alt;
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
function perpM(pt, a, b) {
  const lat0 = rad(a[0]);
  const toXY = p => [rad(p[1]) * Math.cos(lat0) * R, rad(p[0]) * R];
  const [px, py] = toXY(pt), [ax, ay] = toXY(a), [bx, by] = toXY(b);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Douglas–Peucker simplification of a single gap-free segment.
function simplifyOne(seg, epsilonM) {
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
export function simplify(points, epsilonM = 5) {
  const segs = [];
  let cur = [];
  for (const p of points) {
    if (!p) { if (cur.length) { segs.push(cur); cur = []; } }
    else cur.push(p);
  }
  if (cur.length) segs.push(cur);
  const out = [];
  segs.forEach((seg, i) => {
    if (i) out.push(null);
    out.push(...simplifyOne(seg, epsilonM));
  });
  return out;
}

// Split a point array into gap-free segments of [lat,lng] pairs — what Leaflet's
// L.polyline wants (one polyline per segment so gaps aren't bridged).
export function segments(points) {
  const segs = [];
  let cur = [];
  for (const p of points) {
    if (!p) { if (cur.length) { segs.push(cur); cur = []; } }
    else cur.push([p[0], p[1]]);
  }
  if (cur.length) segs.push(cur);
  return segs;
}

// Whether a GeolocationPosition is accurate enough to keep (metres). A missing
// accuracy reading is accepted rather than dropped.
export function accuracyOK(pos, maxM = 35) {
  const acc = pos?.coords?.accuracy;
  return acc == null || acc <= maxM;
}
