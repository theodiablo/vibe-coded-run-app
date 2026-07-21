# Polar (AccessLink) cloud import

The first real vendor-cloud import provider, for runners who leave the phone at
home and record on a **Polar** watch. It pulls each finished exercise's full
detail (GPS route, pace, elevation, heart-rate series) from Polar's cloud and
imports it as a run — the same review/dedupe/auto-tick pipeline every other
import uses.

Polar was chosen as the pilot because AccessLink is the only major vendor API
that is **free and fully self-serve** (no partner-approval wait), returns
GPX/TCX/FIT with route + HR samples, and has **no AI/ML data-use clause** — the
clause that rules out Strava (whose terms ban AI use of API data, and the coach
reads runs). Suunto and COROS are the intended next providers; the seam here is
reusable for them.

## How it's wired

Same shape as every import: a client `ImportProvider` (`src/imports/providers/
polar.ts`) registered in `src/imports/registry.ts`, plus a Supabase edge function
(`supabase/functions/polar-import`) that holds the OAuth **secret** and the
user's token — neither ever reaches the SPA bundle, mirroring `coach-agent`.

- **`polar_tokens` table** (`supabase/migrations/20260721120000_polar_tokens.sql`)
  stores `{ user_id, polar_user_id, access_token }`. It is **service-role only**:
  RLS on, zero `authenticated` grants, so a client can never read the token —
  only the edge function (service_role) touches it.
- **`polar-import` edge function** actions: `status`, `exchange` (code → token,
  register the user with AccessLink, store), `sync` (transaction pull → return
  each exercise's summary + GPX **text**), `disconnect`. It never parses GPX —
  it returns the raw GPX so the **client** parses it with the app's existing,
  tested `parseActivityFile`, so a Polar run gets the same map/pace/HR-series/
  time-in-zone detail a user-picked `.gpx` does.
- **Client provider**: `connect()` is a full-page OAuth redirect; the return is
  completed at boot by `completePolarAuth()` (`RunningCoach`), gated on a `state`
  marker so it never collides with Supabase's own `?code=` PKCE flow. `scan()`
  calls the `sync` action and maps exercises to runs (`polarExerciseToRun`,
  pure + unit-tested); runs are stamped `extId: "polar:<id>"` so the registry
  dedupes them like any other source.
- **Web-only for now.** The redirect flow would navigate a native Capacitor
  webview away from the app, so `isAvailable()` is `false` on native. Native
  support is a follow-up using the existing deep-link return (`AUTH_DEEP_LINK`),
  landing alongside Suunto.

## Activation (maintainer)

Dormant until configured — exactly like `garminCloudProvider` and telemetry.
Without the pieces below, `isAvailable()` is `false`, nothing renders, and the
edge function returns `{ skipped }`. To turn it on:

1. **Register a Polar app** at <https://admin.polaraccesslink.com> (free; any
   Polar Flow account). Note the **client id** and **client secret**.
2. **Set the redirect/OAuth URL** in the Polar app to the deployed web origin
   **with a trailing slash** (e.g. `https://app.example.com/`). It must match
   `redirectUri()` in `providers/polar.ts` exactly.
3. **Server secrets:**
   `supabase secrets set POLAR_CLIENT_ID=… POLAR_CLIENT_SECRET=…`
   then deploy: `supabase functions deploy polar-import` (or the MCP recipe /
   the merge-to-main auto-deploy in `deploy-supabase-functions.yml`).
4. **Client env:** set `VITE_POLAR_CLIENT_ID=<client id>` for the web build
   (same place as `VITE_MAPTILER_KEY`). This is what flips the provider visible.
5. **Apply the migration** (`supabase db push` / preview) so `polar_tokens`
   exists.

Once live, users see a **Polar** row in Settings → Integrations → Connect,
authorize on Polar, land back in the app connected, and their runs sync.

## Verification note

The AccessLink calls follow Polar's documented v3 API but **cannot be exercised
in CI or the dev sandbox** (no credentials; the proxy blocks polar.com). Verify
end-to-end after step 4 with a real Polar account: connect, record/sync a run on
the watch, then confirm it imports with a map + HR chart.

First-run snags to check, in priority order:

1. **`?code=` collision with Supabase auth (must fix before activation).** The
   Supabase client is configured `flowType: "pkce", detectSessionInUrl: true`
   (`src/supabase.ts`), so on any page load it tries to consume a `?code=` param
   as its OWN auth code. Polar's OAuth return also lands as `?code=…` at the
   redirect URL, so the two race — Supabase may error on / strip Polar's code
   before `completePolarAuth()` reads it. The `state=polar_import` marker only
   distinguishes it for *our* handler, not Supabase's. Resolve by making Polar's
   redirect a dedicated route that is intercepted and its code stripped **before**
   the Supabase client initializes (in `main.tsx`, ahead of the `createClient`
   import), or by handling Supabase's own OAuth manually with
   `detectSessionInUrl: false`. This is why the provider is web-only + dormant:
   it must not ship active until this is handled.
2. Token-endpoint field names (`x_user_id`) and the exercise-transaction
   lifecycle (create → list → GET each → commit) against Polar's current docs.

Everything downstream reuses the app's already-tested parsers.
