import { MAP_KEY } from "../constants";

// Extract the best-guess { lat, lng } from a MapTiler geocoding response, or
// null. MapTiler (GeoJSON convention) returns center as [lng, lat].
export function parseGeocodeResult(json) {
  const center = json?.features?.[0]?.center;
  if (!Array.isArray(center) || center.length < 2) return null;
  const [lng, lat] = center;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
}

// One-off forward geocode (place name -> coordinates), used to open the race
// location picker centered near the city/country the contributor already
// typed rather than the world view or their own current position — a
// contributor adding a race is rarely standing where it actually happens.
// Resolves null (never throws) if unconfigured, offline, or no match, so this
// is always an optional convenience, never a blocker to setting a location.
export async function geocodePlace(query) {
  if (!MAP_KEY || !query?.trim()) return null;
  try {
    const res = await fetch(
      `https://api.maptiler.com/geocoding/${encodeURIComponent(query.trim())}.json?key=${MAP_KEY}&limit=1`,
    );
    if (!res.ok) return null;
    return parseGeocodeResult(await res.json());
  } catch {
    return null;
  }
}
