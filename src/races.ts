import { supabase } from "./supabase";
import { currentUserId } from "./db";
import { notifyContribution } from "./notify";

// Shared race catalogue access (Phase 2). Mirrors src/routes.ts: direct supabase
// queries, owner-scoped writes, failure-tolerant reads. The rest of the app never
// imports this directly — catalogue lookups go through src/utils/races.ts, which
// hydrates its cache from listRaces() here. Personal data (participations) stays
// in the app_state blob; this module only touches the shared catalogue tables.

// Map a DB race row + its editions to the joined shape the app already uses
// (the old CURATED_RACES shape): camelCase, id === slug, editions newest-first.
function toRace(row, editions) {
  return {
    id: row.slug,
    slug: row.slug,
    name: row.name,
    city: row.city,
    country: row.country,
    lat: row.lat,
    lng: row.lng,
    distances: row.distances || [],
    url: row.url,
    verified: row.verified,
    createdBy: row.created_by,
    editions: (editions || [])
      .map(e => ({
        id: e.id,
        date: e.date,
        distanceKm: e.distance_km,
        elevation: e.elevation || 0,
        verified: e.verified,
        createdBy: e.created_by,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// Every race grouped with its editions. Failure-tolerant: a failed fetch returns
// [] (the app still renders; My Races falls back to participation snapshots).
export async function listRaces() {
  const [racesRes, edsRes] = await Promise.all([
    supabase.from("races").select("slug, name, city, country, lat, lng, distances, url, verified, created_by"),
    supabase.from("race_editions").select("id, race_slug, date, distance_km, elevation, verified, created_by"),
  ]);
  if (racesRes.error) { console.error("races load failed", racesRes.error); return []; }
  if (edsRes.error) { console.error("race_editions load failed", edsRes.error); return []; }
  const byRace = {};
  for (const e of edsRes.data || []) (byRace[e.race_slug] ||= []).push(e);
  return (racesRes.data || []).map(r => toRace(r, byRace[r.slug]));
}

// kebab-case a name into a slug (strip accents/punctuation, collapse to dashes).
function slugify(s) {
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const isUniqueViolation = err => err?.code === "23505";

// Add a new race (always unverified, owned by the signed-in user). Generates a
// slug from the name, falling back to name-city if that slug is taken, so two
// different races with the same name don't collide. Returns the joined race.
export async function addRace({ name, city, country, lat, lng, distances, url }) {
  const user_id = currentUserId();
  if (!user_id) throw new Error("Not signed in");
  const base = slugify(name) || "race";
  const candidates = [base, slugify(`${name}-${city}`), `${base}-${Date.now().toString(36)}`];
  let lastErr = null;
  for (const slug of candidates) {
    const { data, error } = await supabase
      .from("races")
      .insert({ slug, name, city, country, lat, lng, distances: distances || [], url, verified: false, created_by: user_id })
      .select("slug, name, city, country, lat, lng, distances, url, verified, created_by")
      .single();
    if (!error) return toRace(data, []);
    if (!isUniqueViolation(error)) { lastErr = error; break; }
    lastErr = error; // slug taken — try the next candidate
  }
  throw lastErr || new Error("Could not add race");
}

// Best-effort rollback: delete a race we just created (RLS allows deleting only
// your own rows). Used when the follow-up addEdition fails, so a childless race
// never lingers in the shared catalogue. on-delete-cascade clears any editions.
export async function deleteRace(slug) {
  const { error } = await supabase.from("races").delete().eq("slug", slug);
  if (error) throw error;
}

// Add an edition (dated running) to an existing race. id is `slug-date`; if that
// is already taken (same race + date, different distance) the distance is
// appended so the unique(race_slug,date,distance_km) constraint still holds.
export async function addEdition({ raceSlug, date, distanceKm, elevation = 0 }) {
  const user_id = currentUserId();
  if (!user_id) throw new Error("Not signed in");
  const row = {
    race_slug: raceSlug, date, distance_km: distanceKm,
    elevation: elevation || 0, verified: false, created_by: user_id,
  };
  for (const id of [`${raceSlug}-${date}`, `${raceSlug}-${date}-${distanceKm}`]) {
    const { data, error } = await supabase
      .from("race_editions")
      .insert({ id, ...row })
      .select("id, race_slug, date, distance_km, elevation, verified")
      .single();
    if (!error) return { id: data.id, date: data.date, distanceKm: data.distance_km, elevation: data.elevation, verified: data.verified };
    if (!isUniqueViolation(error)) throw error;
  }
  throw new Error("Could not add edition");
}

// File a moderation report. Inserts WITHOUT a returning .select() — race_reports
// has no client SELECT policy, so reading back the row would 403 even though the
// write succeeds. Best-effort emails the maintainer via the edge function.
export async function reportRace({ raceSlug, editionId, reason, note }) {
  const user_id = currentUserId();
  if (!user_id) throw new Error("Not signed in");
  const id = crypto.randomUUID();
  const { error } = await supabase
    .from("race_reports")
    .insert({ id, race_slug: raceSlug || null, edition_id: editionId || null, reason, note: note || null, reporter_id: user_id });
  if (error) throw error;
  notifyContribution({ type: "report", reportId: id });
}
