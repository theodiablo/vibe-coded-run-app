# "Find me somewhere to run" — loop route suggestions: implementation plan

Status: **plan only, nothing implemented**. Scope: from the user's current
location and a target distance, generate 2-3 candidate LOOP routes (start =
finish) biased toward footpaths/parks/quiet streets, draw them on the map, let
the user pick one, and overlay the chosen line in the live tracker. Loops from
a point only — no point-to-point directions, no multi-waypoint planning.

---

## (a) Recommended backend + licensing verdict

### Comparison

| Backend | Loop (round-trip) support | Foot-profile / bias control | Hosted free tier | Geometry | Software license | Verdict |
|---|---|---|---|---|---|---|
| **openrouteservice** (HeiGIT) | Yes: POST `/v2/directions/{profile}` with `options.round_trip {length, points, seed}` from a single start coordinate | `foot-walking` / `foot-hiking` profiles; `profile_params.weightings` includes **green** and **quiet** weightings — a direct match for "prefer parks, avoid busy roads" | Free API key, ~2000 directions/day, 40/min; round-trip capped at 100 km (irrelevant for running) | GeoJSON; `elevation=true` gives 3D coords | GPL-3.0 (server-side only — no obligation on our client) | **MVP choice** |
| **GraphHopper** | Yes in the OSS engine (`algorithm=round_trip`, needs `ch.disable=true`) | `foot`/`hike` + per-request JSON custom models (penalize `road_class == PRIMARY`, boost footway/path) | **Hosted free tier cannot do round-trips** (flexible mode is paid-only) and is non-commercial only | Encoded polyline or coord array; optional 3D | Apache-2.0 | **Self-host choice** later |
| **BRouter** | Yes, natively since v1.7.8 (`engineMode=roundtrip`, `roundtripDistance`, `direction`, `allowSamewayback`) — engine-level, not the old brouter-web client trick | Fully scriptable cost profiles over raw OSM tags — most controllable of all; we'd write a "running" profile | Public brouter.de server: no key, but **no ToS/SLA** — a community server; fine for dev experiments, not a production dependency | GeoJSON with altitude (elevation-aware by design) | MIT | Ultra-cheap self-host alternative (single Java process, <1 GB RAM, planet ≈ 8 GB of rd5 segment files, no import step) |
| **Valhalla** | **No round-trip feature at all** (confirmed against the turn-by-turn API reference); hosted Valhalla (Stadia Maps etc.) inherits the gap | Good pedestrian costing knobs, but no loop generator to apply them to | n/a | polyline6 | MIT | **Excluded** |
| **Roll our own (Overpass + graph search)** | We'd build cycle search ourselves | Total control | Overpass public instances are fair-use, not a per-request backend | ours | ours | **Excluded for MVP** — months of work; revisit only if "smart loops" becomes a differentiator |
| **MapTiler routing** (we already hold a key) | Routing suite is in beta: directions/matrix/isochrones only, **no round-trip announced** | n/a | n/a | n/a | n/a | Watch, unusable today |

### Licensing verdict (the Strava-style vetting)

- **No AI-use or model-training restrictions** were found in the terms of ORS,
  GraphHopper, BRouter, or Valhalla — nothing like the Strava clause that got
  Strava excluded. Underlying data is OSM under **ODbL**: we must show
  "© OpenStreetMap contributors" wherever route geometry is displayed. RouteMap
  already renders exactly that attribution for the basemap, so suggested-route
  display is covered by the same visible credit.
- **ORS free tier**: terms allow app use with attribution; it's best-effort (no
  SLA) and low-volume. Add a "Powered by openrouteservice" line in the finder
  sheet. At real scale HeiGIT expects a paid plan — our migration path is
  self-hosting instead (below), so we never depend on their pricing.
- **GraphHopper hosted free tier is excluded twice over**: non-commercial only,
  and round-trip requires flexible mode which the free plan forbids. The OSS
  engine (Apache-2.0) has no such limits.
- **brouter.de**: no published usage policy — do not build the shipped app on
  it. Self-hosted BRouter (MIT) is clean.

### Recommendation

**MVP: openrouteservice public API, called from a new Supabase edge function**
(key custody + rate limiting server-side, see (d)). It is the only zero-infra
option with a real loop endpoint, and its green/quiet foot weightings are the
closest off-the-shelf match to the product intent.

**Long-term: self-hosted GraphHopper OSS** (Apache-2.0, same round-trip
algorithm family — ORS is a GraphHopper fork, so request/response mapping
barely changes), with **BRouter** as the minimal-cost fallback if server RAM
is the constraint. Because the client only ever talks to our edge function,
this migration is invisible to the app.

**Quality reality check**: every round-trip engine works by dropping
pseudo-via-points on a circle with randomness — expect ±10-20% length error
and occasional out-and-back stretches. The standard fix (and our design) is:
request 3 candidates with different `seed`s, score them client-side (length
error, self-overlap), and present the best 2-3. "Regenerate" = new seeds.

---

## (b) MVP scope

One flow, behind a config gate, reusing existing seams end to end:

1. **Entry point**: a "Find a route" secondary button on the live tracker's
   **idle** screen (`LiveRunTracker`, next to Start). The tracker idle state
   already runs a foreground-only `geoSource.watchPosition` preview and shows
   GPS accuracy — the user's position is already in hand as `location`, no new
   geolocation code. (A Dashboard entry can come later; the tracker is where
   the intent "I'm about to run" already lives.)
2. **RouteFinderSheet** (new, `src/modals/RouteFinderSheet.tsx`): distance
   chips (3 / 5 / 8 / 10 km + free input following the number-input
   convention), a RouteMap showing candidates, one compact card per candidate
   (distance, est. elevation gain, a one-line character such as "mostly paths"
   derived from ORS way-type extras), the safety framing line, and OSM/ORS
   attribution. Registers `useDismissable`. Selected candidate is highlighted;
   "Run this route" confirms.
3. **Fetch**: client calls the `route-suggest` edge function with
   `{lat, lng, km}`; the function fans out 3 ORS round-trip requests (seeds
   0/1/2, `foot-walking`, green+quiet weightings, `elevation=true`) and
   returns the raw GeoJSON features. Client decodes to point arrays, runs the
   existing `simplify()`, and measures with `distanceKm`/`elevGainM` — the
   same utils the tracker trusts, so displayed numbers can't drift from
   recorded ones.
4. **Pick one → run it**: the sheet closes and the chosen candidate becomes
   the tracker's planned-line overlay (see (c)). Start/record/save are
   completely unchanged.

Client API module `src/utils/routeSuggest.ts` mirrors `geocode.ts` exactly:
config-guarded, plain invoke, **never throws** — resolves `null` when
unconfigured / offline / rate-limited / no result, with a small exported pure
parser (`parseLoopCandidates`) that is unit-tested like `parseGeocodeResult`.
`null` surfaces as a toast ("Couldn't fetch routes right now"); the tracker is
never blocked.

Out of scope for MVP: turn-by-turn guidance, off-route alerts, saving
suggestions, elevation preferences, avoiding past routes.

---

## (c) Data model and where state lives

A **suggested route is NOT a recorded trace**. It never touches `run_routes`
or `routeId`; it is ephemeral client memory, discarded on dismissal.

```ts
// src/types.ts
export type SuggestedRoute = {
  id: string;                       // local nonce, e.g. "sr" + seed
  points: [number, number, number | null][]; // [lat, lng, altM|null] — no timestamps (nothing was run)
  km: number;                       // measured via distanceKm()
  elevation: number;                // measured via elevGainM()
  character?: string;               // i18n key for the one-liner, resolved at render
};
```

- **Where it lives**: React state inside `RouteFinderSheet` (the candidate
  list) and one `plannedRoute: SuggestedRoute | null` state in
  `LiveRunTracker`. Nothing in the synced blob, nothing in localStorage,
  nothing in Supabase. Close the tracker → gone. (Persisting favorites is
  Phase 4 and gets its own table then.)
- **RouteMap change**: add an optional `guidePoints` prop drawn as its own
  polyline layer *under* the recorded line and excluded from the
  follow/fitBounds logic once recording starts. This is the only RouteMap
  edit; the existing `points` contract is untouched.
- **Handoff to the tracker**: purely visual. `LiveRunTracker` passes
  `guidePoints={plannedRoute?.points}` to its existing RouteMap. useRunTracker
  is not modified at all — recording, gap logic, save, HR: all identical. The
  runner follows the line by eye (MVP); guidance is a follow-up.
- **On save**: nothing of the suggestion persists in MVP. Later, if useful for
  analytics/favorites, a summary could ride the route `stats` free-form
  sidecar (e.g. `stats.plannedKm`) — never the points.

Distinct visual treatment (recorded line is orange `#f97316`): the planned /
candidate line is **sky `#38bdf8`, dashed** (`dashArray: "6 8"`), matching the
existing sky-blue "preview position" dot family, so live-recorded vs planned
can never be confused; the selected candidate in the sheet renders solid sky,
unselected ones slate `#64748b` at lower opacity.

---

## (d) Server, keys, CSP, dormant-until-configured

### Client vs server: edge function

The ORS key is quota-bearing and **cannot be domain-restricted** (unlike the
publishable MapTiler key), so it must not ship in the bundle. Following the
coach-agent trust boundary:

- New edge function `supabase/functions/route-suggest` (Deno): verifies the
  Supabase JWT, enforces a per-user daily limit, reads `ORS_API_KEY` from
  function secrets, fans out the 3 seeded round-trip calls, and passes the
  GeoJSON through. It is a thin proxy — all parsing/scoring stays in tested
  client code (or in `_shared/` .mjs if the scoring later needs to be
  server-side, per the coach `_shared` pattern).
- **Rate limiting**: mirror the coach's atomic counter — a
  `route_suggest_usage` table + `increment_route_suggest_usage` SQL function
  (service-role writes only), limit ~30 generations/user/day. Same
  append-only-migration rules.
- **Bonus: zero CSP change.** The client only calls
  `https://<ref>.supabase.co/functions/v1/route-suggest`, already covered by
  `connect-src https://*.supabase.co` in the one `index.html` CSP that both
  web and the Capacitor shells ship. No new host reaches the client. (If a
  future phase ever calls a routing host directly from the client, that host
  gets added to `connect-src` then — one edit, all platforms.)

### Dormant until configured (the Polar pattern)

Two independent gates, both defaulting to off:

- **Client**: `export const routeSuggestEnabled = !!import.meta.env.VITE_ROUTE_SUGGEST && !!MAP_KEY;`
  — the "Find a route" button simply doesn't render without the flag (and
  without map tiles the feature is pointless, hence the `MAP_KEY` guard).
  Thread `VITE_ROUTE_SUGGEST` (a repo **variable**, not a secret — it's just
  `"1"`) through the same five workflow build steps that already pass
  `VITE_MAPTILER_KEY` / `VITE_POLAR_CLIENT_ID`: `deploy.yml`, `deploy-pr.yml`,
  `android-pr.yml`, `android-main.yml`, `release.yml` (+ `ios-pr.yml` if it
  builds the web bundle). Native shells get it via the same web-build env, so
  web + Android + iOS enable together.
- **Server**: `route-suggest` without `ORS_API_KEY` set responds
  `{configured:false}`; the client treats that as `null` (feature shows the
  generic "couldn't fetch" toast if somehow reached). Deploy via the existing
  `deploy-supabase-functions.yml`.

### Native + offline

- Works in both shells unchanged: same bundle, same CSP, geolocation via the
  existing `geoSource` seam (the tracker's idle preview already respects the
  native permission gating — the finder button only makes sense once
  `location` exists, so it inherits that gate for free: disabled until a fix
  arrives).
- Offline / API down / rate-limited: `routeSuggest()` resolves `null`, toast,
  tracker fully usable. The feature never blocks recording, saving, or app
  boot. No retries beyond one; no background polling.

---

## (e) UX details, safety framing, i18n

- **Safety copy** (shown in the sheet, small, always visible — not a
  dismissable warning): frame as *suggestions from open map data*, e.g. EN
  "Routes are suggested from open map data and haven't been checked on the
  ground. Stay alert: paths can cross roads or be closed or private." Neutral
  and factual, no liability-flavored legalese. Bias hard toward well-mapped
  paths at the request level (green/quiet weightings, `foot-walking`) so the
  copy rarely has to do the work.
- **Candidate comparison**: per card — distance (`x.x km`), elevation gain
  (`+xx m`), one-line character bucketed from the % of the route on
  footway/path/park way types (returned in ORS `extras`): "mostly paths" /
  "mixed streets and paths" / "mostly streets". Whole-minute estimates, if
  ever shown, use `fmt.mins`.
- **i18n**: all copy under a `routeFinder.*` namespace in
  `src/i18n/locales/{en,fr,es}` — French informal `tu` ("Reste attentif…"),
  Spanish region-neutral, **no em dashes** (enforced by `i18n.test.ts`).
- Buttons follow existing conventions: icon-only buttons get `aria-label`;
  sheet uses `ModalOverlay`-style dark-slate surfaces, orange-500 only for the
  confirm action ("Run this route"), sky for route lines.

---

## Phases

**Phase 1 — MVP (small, shippable, dormant by default)**
- `route-suggest` edge function + usage table/migration + function secret.
- `src/utils/routeSuggest.ts` (never-throws client + pure `parseLoopCandidates`, unit tests).
- `RouteMap` `guidePoints` prop (sky dashed layer).
- `RouteFinderSheet` modal + entry button on tracker idle screen (gated by `routeSuggestEnabled`).
- `plannedRoute` handoff in `LiveRunTracker`.
- i18n keys (en/fr/es), safety copy, ORS/OSM attribution line.
- Workflow env threading (`VITE_ROUTE_SUGGEST`), docs entry, telemetry event
  (`route_suggested` count only, consent-gated as usual).

**Phase 2 — candidate quality**
- Client-side scoring: reject/re-seed candidates with >20% length error or
  heavy self-overlap; auto-retry with fresh seeds up to a small cap.
- Elevation preference toggle (flat / rolling / hilly) → `foot-walking` vs
  `foot-hiking` + post-filter by `elevGainM` per km.
- "Regenerate" button (new seeds), still within the daily limit.

**Phase 3 — personal context**
- "Somewhere new": penalize candidates overlapping the bounding boxes /
  simplified lines of recent `run_routes` traces (fetched lazily, compared
  client-side with `haversineM` — coordinates never leave the device, keeping
  the coach's coordinate-free privacy stance intact).
- Start from a chosen point (map long-press) instead of current location only.

**Phase 4 — persistence + independence**
- Saved favorite loops: a new `saved_routes` table (RLS per user), separate
  from `run_routes` so planned geometry never pollutes recorded traces.
- Self-host GraphHopper OSS (or BRouter) and repoint the edge function —
  no client change, removes the ORS quota/SLA dependency.
- Watch MapTiler's routing beta for a possible key-consolidation move.
