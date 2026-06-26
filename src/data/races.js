// Curated, read-only race catalogue (Phase 1).
//
// A "race" is the recurring event; an "edition" is one dated running of it. Each
// edition is what a user wishlists, targets, or completes. The catalogue is kept
// OUT of the per-user app_state blob — it's shared reference data. In Phase 2
// this seed migrates into a shared Supabase `races`/`race_editions` table and a
// `src/races.js` module serves it behind the same shape, so keep these objects
// flat and serialisable.
//
// Dates/distances are curated and approximate — the UI links each race's
// official site and tells users to verify there, because a training plan is
// built around the date. Coordinates are the start/host city (used by Phase 2's
// "near me"). `verified: true` marks these as the trusted curated set;
// user-added races (Phase 2) will be `verified: false`.
//
// Lean: global marathon majors + a strong Europe focus (ES / FR / UK).

// Build an edition id from a slug + ISO date, so it's stable across reloads.
const ed = (slug, date, distanceKm, elevation = 0) => ({
  id: slug + "-" + date,
  date,
  distanceKm,
  elevation,
});

export const CURATED_RACES = [
  // ── World Marathon Majors ────────────────────────────────────────────────
  {
    id: "berlin-marathon", name: "BMW Berlin Marathon", city: "Berlin",
    country: "DE", lat: 52.5163, lng: 13.3777, distances: [42.2],
    url: "https://www.bmw-berlin-marathon.com/", verified: true,
    editions: [ed("berlin-marathon", "2026-09-27", 42.2, 60)],
  },
  {
    id: "london-marathon", name: "TCS London Marathon", city: "London",
    country: "GB", lat: 51.5074, lng: -0.1278, distances: [42.2],
    url: "https://www.tcslondonmarathon.com/", verified: true,
    editions: [ed("london-marathon", "2027-04-25", 42.2, 110)],
  },
  {
    id: "chicago-marathon", name: "Chicago Marathon", city: "Chicago",
    country: "US", lat: 41.8757, lng: -87.6244, distances: [42.2],
    url: "https://www.chicagomarathon.com/", verified: true,
    editions: [ed("chicago-marathon", "2026-10-11", 42.2, 30)],
  },
  {
    id: "nyc-marathon", name: "TCS New York City Marathon", city: "New York",
    country: "US", lat: 40.7029, lng: -74.0170, distances: [42.2],
    url: "https://www.nyrr.org/tcsnycmarathon", verified: true,
    editions: [ed("nyc-marathon", "2026-11-01", 42.2, 250)],
  },
  {
    id: "tokyo-marathon", name: "Tokyo Marathon", city: "Tokyo",
    country: "JP", lat: 35.6895, lng: 139.6917, distances: [42.2],
    url: "https://www.marathon.tokyo/en/", verified: true,
    editions: [ed("tokyo-marathon", "2027-03-07", 42.2, 90)],
  },
  {
    id: "boston-marathon", name: "Boston Marathon", city: "Boston",
    country: "US", lat: 42.3601, lng: -71.0589, distances: [42.2],
    url: "https://www.baa.org/", verified: true,
    editions: [ed("boston-marathon", "2027-04-19", 42.2, 250)],
  },

  // ── France ───────────────────────────────────────────────────────────────
  {
    id: "marathon-de-paris", name: "Marathon de Paris", city: "Paris",
    country: "FR", lat: 48.8566, lng: 2.3522, distances: [42.2],
    url: "https://www.schneiderelectricparismarathon.com/", verified: true,
    editions: [ed("marathon-de-paris", "2027-04-11", 42.2, 120)],
  },
  {
    id: "20km-de-paris", name: "20 km de Paris", city: "Paris",
    country: "FR", lat: 48.8584, lng: 2.2945, distances: [20],
    url: "https://www.20kmparis.com/", verified: true,
    editions: [ed("20km-de-paris", "2026-10-11", 20, 90)],
  },
  {
    id: "marseille-cassis", name: "Marseille-Cassis", city: "Marseille",
    country: "FR", lat: 43.2965, lng: 5.3698, distances: [20],
    url: "https://www.marseille-cassis.com/", verified: true,
    editions: [ed("marseille-cassis", "2026-10-25", 20, 320)],
  },
  {
    id: "marvejols-mende", name: "Marvejols-Mende", city: "Mende",
    country: "FR", lat: 44.5180, lng: 3.4996, distances: [22.4],
    url: "https://www.marvejols-mende.fr/", verified: true,
    editions: [ed("marvejols-mende", "2026-07-19", 22.4, 600)],
  },
  {
    id: "marathon-du-medoc", name: "Marathon du Médoc", city: "Pauillac",
    country: "FR", lat: 45.1985, lng: -0.7459, distances: [42.2],
    url: "https://www.marathondumedoc.com/", verified: true,
    editions: [ed("marathon-du-medoc", "2026-09-12", 42.2, 80)],
  },
  {
    id: "utmb", name: "UTMB Mont-Blanc", city: "Chamonix",
    country: "FR", lat: 45.9237, lng: 6.8694, distances: [171],
    url: "https://utmbmontblanc.com/", verified: true,
    editions: [ed("utmb", "2026-08-28", 171, 10000)],
  },

  // ── Spain ──────────────────────────────────────────────────────────────
  {
    id: "behobia-san-sebastian", name: "Behobia-San Sebastián",
    city: "San Sebastián", country: "ES", lat: 43.3183, lng: -1.9812,
    distances: [20], url: "https://www.behobia-sansebastian.com/", verified: true,
    editions: [ed("behobia-san-sebastian", "2026-11-08", 20, 200)],
  },
  {
    id: "valencia-marathon", name: "Valencia Marathon", city: "Valencia",
    country: "ES", lat: 39.4699, lng: -0.3763, distances: [42.2],
    url: "https://www.valenciaciudaddelrunning.com/", verified: true,
    editions: [ed("valencia-marathon", "2026-12-06", 42.2, 10)],
  },
  {
    id: "barcelona-marathon", name: "Barcelona Marathon", city: "Barcelona",
    country: "ES", lat: 41.3851, lng: 2.1734, distances: [42.2],
    url: "https://www.zurichmaratonbarcelona.es/", verified: true,
    editions: [ed("barcelona-marathon", "2027-03-14", 42.2, 120)],
  },
  {
    id: "sevilla-marathon", name: "Zurich Maratón de Sevilla", city: "Sevilla",
    country: "ES", lat: 37.3891, lng: -5.9845, distances: [42.2],
    url: "https://www.zurichmaratonsevilla.es/", verified: true,
    editions: [ed("sevilla-marathon", "2027-02-21", 42.2, 20)],
  },
  {
    id: "san-silvestre-vallecana", name: "San Silvestre Vallecana",
    city: "Madrid", country: "ES", lat: 40.4168, lng: -3.7038, distances: [10],
    url: "https://www.sansilvestrevallecana.com/", verified: true,
    editions: [ed("san-silvestre-vallecana", "2026-12-31", 10, 90)],
  },

  // ── United Kingdom ─────────────────────────────────────────────────────────
  {
    id: "great-north-run", name: "Great North Run", city: "Newcastle",
    country: "GB", lat: 54.9783, lng: -1.6178, distances: [21.1],
    url: "https://www.greatrun.org/great-north-run/", verified: true,
    editions: [ed("great-north-run", "2026-09-13", 21.1, 130)],
  },
  {
    id: "cardiff-half", name: "Cardiff Half Marathon", city: "Cardiff",
    country: "GB", lat: 51.4816, lng: -3.1791, distances: [21.1],
    url: "https://www.cardiffhalfmarathon.co.uk/", verified: true,
    editions: [ed("cardiff-half", "2026-10-04", 21.1, 50)],
  },
  {
    id: "brighton-marathon", name: "Brighton Marathon", city: "Brighton",
    country: "GB", lat: 50.8225, lng: -0.1372, distances: [42.2],
    url: "https://www.brightonmarathonweekend.co.uk/", verified: true,
    editions: [ed("brighton-marathon", "2027-04-11", 42.2, 90)],
  },
  {
    id: "manchester-marathon", name: "Manchester Marathon", city: "Manchester",
    country: "GB", lat: 53.4808, lng: -2.2426, distances: [42.2],
    url: "https://www.manchestermarathon.co.uk/", verified: true,
    editions: [ed("manchester-marathon", "2027-04-18", 42.2, 40)],
  },
  {
    id: "edinburgh-marathon", name: "Edinburgh Marathon", city: "Edinburgh",
    country: "GB", lat: 55.9533, lng: -3.1883, distances: [42.2],
    url: "https://www.edinburghmarathon.com/", verified: true,
    editions: [ed("edinburgh-marathon", "2027-05-30", 42.2, 60)],
  },
];

// Flat list of every edition joined to its parent race — convenient for lookups
// and the catalogue browser. Each entry carries the race fields plus `edition`.
export const CURATED_EDITIONS = CURATED_RACES.flatMap(r =>
  r.editions.map(e => ({ ...r, editions: undefined, raceId: r.id, edition: e }))
);
