# Running Coach

A React 19 + Vite single-page running-training app. State is client-side and
mirrored through `db` into an in-memory cache that debounce-upserts to a single
per-user Supabase `app_state` JSONB row. It's failure-tolerant: a failed load
falls back to an empty cache so the app still renders.

## Maintaining this file
Keep this file current. When you learn something durable about the project (a
non-obvious convention, gotcha, or architectural decision) or about the
maintainer's preferences, edit the relevant section here in the same change.
Record reusable rules, not a changelog of what you did — keep entries concise
and delete anything that becomes stale.

## Commands
- `npm install` — **run first in a fresh checkout**; deps are not committed, so
  `lint`/`test`/`build` all fail with module-not-found until you do. (`vite` /
  `vitest` aren't on PATH otherwise — use the npm scripts or `npx`.)
- `npm run dev` — local dev server (Vite).
- `npm test` — Vitest (run mode). `npm run test:watch` for watch. Suite lives in
  `src/utils/*.test.js`.
- `npm run lint` — ESLint (flat config). Catches unused imports/vars; keep it clean.
- `npm run build` — production build.

## Architecture
- **No router.** `src/RunningCoach.jsx` is the **single state hub**: it owns
  `runs`, `plan`, `settings`, modal flags, and the active `tab`, and passes a
  `shared` props bag down to every view. The five views switch on `tab`
  (`dash`, `plan`, `log`, `history`, `stats`).
- To add cross-view state or an action, define it in `RunningCoach.jsx` and add
  it to `shared` (e.g. `goTab`, `goLog`, `addRuns`, `toggleSess`).
- **Persistence:** `db.get/set(STORAGE_KEYS.*)` (`src/db.js`, `src/constants.js`;
  keys `rc_runs`, `rc_plan`, `rc_settings`). Every state change is mirrored to
  `db` in the same handler that calls `setState`. Writes debounce ~600ms into a
  single upsert and flush on page hide/unload.
- **Supabase config:** URL and anon key live in `src/config.js` (imported by
  `src/supabase.js`). Env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
  override them at build time. Don't hardcode credentials elsewhere.
- **Multi-user:** The app is open to public signups — don't make single-user
  assumptions. Every user gets their own isolated data via RLS on `app_state`
  and `profiles`.
- **App versioning / update gate (native only):** build version is NOT in the DB
  — `versionCode` is the CI run number, `versionName` is the `android-v*` tag
  (`android/app/build.gradle` reads them from env). The world-readable `app_config`
  row owns *policy*: `latest_version` (soft "update available" banner, written by
  the release workflow) and `min_supported_version` (hard gate, bumped by hand on a
  breaking change). `App.jsx` compares the installed version (`App.getInfo()`) via
  `versionStatus` (`src/utils/version.js`); a failed check never blocks the user.
- **Derived-state resets are done during render, not in effects** — see the
  `if (plan !== prevPlan)` pattern in `PlanView.jsx`. Follow that style.
- **Telemetry (analytics + crash reporting):** all routed through one
  vendor-agnostic seam, `src/telemetry/index.js`; the vendor (**PostHog**) lives
  behind it in `src/telemetry/posthog.js`, the **only** file that imports an SDK.
  App code never imports the SDK directly. It's a **no-op until keyed**
  (`VITE_POSTHOG_KEY`; default host `https://eu.i.posthog.com`), and `posthog-js`
  is a **dynamic import** so it stays out of the main bundle / any keyless build.
  Consent is **opt-in** (EU/ePrivacy): nothing collected until the user accepts
  the first-run `ConsentBanner` (`src/components/ConsentBanner.jsx`, rendered in
  `App.jsx` over login + app); changeable in Settings → Privacy. The single
  source of truth is `localStorage` (`rc_telemetry_consent_v2`), **per-device** (NOT
  the synced blob — a fresh browser re-asks) and tri-state (`"1"`/`"0"`/absent =
  granted/denied/undecided; see `getConsentDecision`). The `ErrorBoundary`
  (`src/components/ErrorBoundary.jsx`, wraps `<App/>` in `main.jsx`) auto-reports
  on web but, on **native, prompts per-crash before sending**. `track`/
  `identifyUser` are consent-gated; `captureError` is gated by its call sites.
  See `docs/telemetry.md` before adding/swapping a provider or an event.
- **Layout:** views in `src/views/`, modals/full-screen flows in `src/modals/`,
  reusable widgets in `src/components/`, pure helpers in `src/utils/`.
- `settings` is the central config object (race fields, HR profile, `planSessions`,
  `name`, `onboarded`). The training plan is (re)built by
  `buildPlan(raceDate, goalSec, planSessions, distanceKm, raceElevation, opts)`
  (`src/utils/plan.js`). The `opts` object is additive (positional call sites keep
  working): `recentRuns` seeds a **fitness-aware** BASE start (longest run in the
  last ~5 weeks, clamped to the race-scaled peak) so a fit athlete isn't reset to a
  tiny long run; `mainEditionId` + `races` drive the **secondary-race overlay**.
  The long run is scaled to **race distance** (~0.9× for ≤half, ~30-32 km marathon,
  ≤36 km ceiling for ultras), NOT capped by the long-session minutes — so it can
  exceed the configured long-day duration; PlanView shows an honest nudge when it
  does. `plan.longRunPeakKm` exposes the peak for that nudge.
- **Multi-race plans (no user-facing priority):** the plan peaks/tapers for the
  **main** race (`settings.targetEditionId`, the "Training target"); other races the
  user flags with `participation.inPlan` are folded in as RACE sessions (id
  `race-{editionId}`) by `buildPlan` when before the target and inside the window.
  A *substantial* secondary race (≥ half the main distance) auto-gets a mini-taper
  week; a small one just drops in — the user picks nothing (no A/B/C). Toggling a
  race in/out goes through `setRaceInPlan` (`RunningCoach.jsx`), which rebuilds the
  plan **preserving done/skipped by session id** (`carryProgress`) so progress isn't
  wiped. Every RACE session is stamped with its `editionId`; race-day auto-detect
  (`detectAnyRace` in `src/utils/races.js`) matches a logged run against **all** plan
  races, not just the target.
- `raceDate`, `distanceKm`, and `goalSec` start **empty** (`""`) — there are no
  seeded race defaults. Anything reading them before setup must guard (the
  Dashboard race card and Generate buttons gate on `raceDate && distanceKm`),
  not assume a value.

## Live run tracking (GPS)
- **Single GPS funnel:** `src/hooks/useRunTracker.js` owns all geolocation
  (`watchPosition`), the start/pause/resume/stop state machine, moving-time
  accounting, wake lock, and a `localStorage` recovery buffer (`LIVE_RUN_KEY`,
  deliberately NOT synced to the app_state blob). Keep GPS access behind this hook
  so a future native shell can swap the source without touching the UI.
- **UI:** `src/modals/LiveRunTracker.jsx` (full-screen, gated by `showTracker` in
  `RunningCoach`, opened via `shared.openTracker`). On finish it funnels into the
  normal save path — `goLog(prefill)` → `LogView` → `addRuns` — passing measured
  `durationSec`/`elevation` and the trace ref.
- **Traces are NOT in the blob.** The polyline lives in its own Supabase
  `run_routes` table via `src/routes.js` (direct queries, not `db`); a run only
  stores a `routeId` reference. `deleteRun` cascades to `deleteRoute`; backup/
  restore include routes. Offline saves queue in `localStorage` and relink on next
  load via `flushPendingRoutes` (run carries a temp `routeTmp`/`routePending`).
- **Geo math:** `src/utils/geo.js` (haversine, jitter-gated `distanceKm`,
  hysteresis `elevGainM`, Douglas–Peucker `simplify`, `segments`). A point is the
  tuple `[lat, lng, tEpochMs, alt|null]`; a `null` entry is a GAP marker (don't
  bridge it). Map basemap is MapTiler — needs `VITE_MAPTILER_KEY` (records fine
  without it, just no tiles).
- **Phase 2 — native background tracking:** browser tracking is foreground-only
  (screen must stay on). True background recording runs in a **Capacitor Android
  shell** that swaps the GPS source behind `useRunTracker`'s interface. The hook
  never touches `navigator.geolocation` directly anymore — it goes through
  `geoSource` (`src/geo/source.js`), which picks `webSource` (`src/geo/web.js`,
  `navigator.geolocation`, unchanged web behaviour) or `nativeSource`
  (`src/geo/native.js`: @capacitor-community/background-geolocation foreground
  service for `background:true`, @capacitor/geolocation for the idle preview).
  Selection is by `isNative` (`src/native.js` → `Capacitor.isNativePlatform()`),
  which also sets `window.__NATIVE_SHELL__` for the UI. **One bundle serves both**
  web and shell; `isNative` is false in any browser, so the web build is unchanged
  — keep it that way. To add a GPS source, implement the
  `isAvailable / watchPosition(onPos,onErr,{background}) / clearWatch` interface and
  hand `onPos` a `{coords:{latitude,longitude,altitude,accuracy}, timestamp}` object
  (see `adaptBgLocation`). Native auth uses a deep link (`AUTH_DEEP_LINK` in
  `src/supabase.js`, completed in `App.jsx`). Build: `npx cap sync android` then
  `.github/workflows/android.yml`; the web S3/CloudFront deploy stays untouched.

## Races & badges (gamification)
- **Catalogue (Race → Edition):** a "race" is the recurring event, an "edition" a
  dated running of it (the thing you wishlist / target / complete). Edition id =
  `slug-YYYY-MM-DD` (stable across reloads; `addEdition` suffixes `-distanceKm`
  only on a same-race-same-date collision). **Phase 2 = shared, global, live:**
  the catalogue lives in Supabase tables `races` + `race_editions`
  (`supabase/migrations/20260629120000_races_catalogue.sql`; world-readable like
  `app_config`, owner-scoped writes like `run_routes`, with a hard `verified = false`
  with-check so a contributor can never self-verify — only the service role does).
  `src/races.js` is the access module (mirrors `src/routes.js`: direct queries —
  `listRaces`/`addRace`/`addEdition`/`reportRace`/`notifyContribution`). **The old
  bundle is gone** — keep ALL catalogue lookups going through `src/utils/races.js`
  (`allRaces`, `allEditions`, `findEdition`, `findRace`), which holds the fetched
  catalogue in a module cache (`hydrateCatalogue`) loaded once at boot by
  `loadCatalogue`. **Failure-tolerant:** a failed fetch leaves the cache `[]` and
  the app still renders (My Races falls back to participation snapshots); the boot
  load is fired **unawaited** so a slow/down Supabase never blocks the splash.
- **Contributions are instant + global + unverified.** "Add a race"
  (`src/modals/RaceFormModal.jsx`, opened via `shared.openRaceForm`) does a live
  duplicate search and inserts `verified:false, created_by=uid`; the UI tags any
  unverified race/edition. After a contribution, `refreshCatalogue` (RunningCoach)
  re-fetches so it shows immediately. **Discover** is a RacesView segment: one-off
  `geoSource.getCurrentPosition()` (web/native), sort by `haversineM`, distance-band
  + radius chips. **km-only**; coordinates are never persisted or sent to telemetry.
- **Moderation:** `reportRace` writes a `race_reports` row (insert-only RLS, no
  client SELECT — so insert WITHOUT `.select()`) and best-effort invokes the
  `notify-contribution` edge function (`supabase/functions/`), which emails the
  maintainer + thanks the contributor via Resend (`RESEND_API_KEY`; degrades to a
  no-op if unset). The "verified → thank-you" half is in-app: `reconcileVerifiedThanks`
  (RunningCoach) toasts once when a maintainer verifies the user's own contribution.
- **Personal layer lives in the blob**, key `STORAGE_KEYS.RACES` (`rc_races`), NOT
  in the catalogue: `{participations:[...], seenBadges:[...], ackVerified:[...]}`
  (`ackVerified` = which of the user's verified contributions we've already thanked
  them for). A participation snapshots `label/raceDate/distanceKm` alongside the
  `editionId` so a wishlist entry survives if the catalogue edition disappears
  (orphan tolerance). It's in the synced blob, so it's covered by backup/restore
  (add to both when extending) — the shared catalogue is NOT exported.
- **One training target:** `settings.targetEditionId` marks which edition the plan
  was built from. Promote via `promoteEdition` (`RunningCoach.jsx`) → prefills
  PlanView's setup; the plan is built there (reusing `buildPlan`), which sets
  `targetEditionId`. Hand-editing the race in PlanView **clears** it (decouple).
- **Two ways to complete:** manual "log result" (RacesView, optionally also adds a
  RACE run via `addRuns(..., {skipDetect:true})`), or **auto-detect** — a saved run
  on `settings.raceDate` within ±18% of the target distance triggers an undoable
  "mark done" toast (`detectRaceCompletion` + `detectCompletion` in
  `RunningCoach.jsx`).
- **Badges are pure & derived** (`computeBadges(runs, participations)` in
  `src/utils/badges.js`) — never stored except `seenBadges`. Reconcile in event
  handlers, NOT an effect (the `react-hooks` rule forbids sync setState in
  effects): `reconcileBadges` seeds `seenBadges` silently on first run, then toasts
  only new unlocks. Icons are lucide *names* mapped in `Badge.jsx` to keep
  `badges.js` React-free/testable. Tone is gentle: cumulative active-weeks (not
  fragile streaks) and WALK counts.
- **Nav:** Record is a center **FAB** (it's an action, not a destination); the four
  row tabs are Home · Plan · Races · Progress. **Progress** (`ProgressView.jsx`)
  merges the old History + Stats under a toggle and adds Badges.

## Data shapes
- **Run:** `{id, date, type, km, durationSec, hr, hrMax, elevation, effort, notes}`
  plus, for GPS-tracked runs, `{source:"gps", routeId}` (the `run_routes` ref).
  `id` is generated in `addRuns` if absent; runs are kept sorted newest-first.
- **Route:** `run_routes` row `{id, user_id, points, stats, created_at}` where
  `points` is the simplified `[lat,lng,t,alt]` array (null = gap) and `stats` is
  `{km, durationSec, elevation, avgPace}`.
- **Plan:** `buildPlan(...)` → `{..., weeks:[{weekNumber, startDate, phase,
  sessions:[{id, date, type, desc, km, pace, done}]}]}`.
  Session types: EASY, TEMPO, INTERVALS, LONG, RACE, WALK, OTHER.

## Conventions
- Reuse existing form pieces rather than re-rolling inputs: `SessionConfigurator`
  (training days), `GoalConfigurator` (goal time/pace — a slider whose range
  comes from `paceBand(distanceKm)` in `src/utils/goal.js`, plus editable Time /
  Pace text fields for exact entry that commit on blur/Enter via `parseDur`, with
  a pre-filled mid-pack suggestion), `INPUT_CLS` /
  `LABEL_CLS` (`src/constants.js`) for input styling, type colors `TCLR`, day
  names `DAYS`, and the `fmt` helpers (`src/utils/format.js`) for durations/paces.
- A logged run renders as `RunRow` (`src/components/RunRow.jsx`) — the shared
  card used by both the dashboard's recent-runs list and the History view. Pass
  `dateFmt` (`fmt.sht` vs `fmt.date`), `showNotes`, and an `actions` slot rather
  than re-rolling the markup, so the two lists never drift.
- Show a whole-minute duration with `fmt.mins` (`30min` / `1h` / `1h50`), never a
  bare `minutes / 60` — that prints `1.8333333333333335h`.
- Number inputs: keep an emptied field empty while editing. Don't write
  `parseFloat(e.target.value) || 0` — the `|| fallback` snaps the value back to
  a default as soon as the user clears it. Coalesce to a number only at use time
  (`buildPlan`/persistence), not in the `onChange`.
- Tailwind utility classes inline; dark slate palette with orange-500 accents.
- Dates are `YYYY-MM-DD` strings; use `ymd()` and the `fmt.*` helpers
  (`src/utils/format.js`) for durations/paces. Parse local dates as
  `new Date(s + "T00:00:00")`.
- First-run onboarding lives in `src/modals/OnboardingWizard.jsx`. It **branches
  on `settings.intent`** (`"race"` | `"fitness"`): Welcome → Intent ─┬─ race: Pick
  race → Goal & days ─┐ └─ fitness: Your training ─┤ → Heart rate → **Health &
  safety** → Summary. The branch order is the pure `onboardingSteps(intent)`
  (`src/utils/onboarding.js`, unit-tested); both branches share an identical
  `[welcome, intent]` prefix and end with the health gate then summary.
  - **Race branch** uses the catalogue: a search (`searchEditions` in
    `src/utils/races.js`, upcoming-only) autofills date/distance/elevation and sets
    `targetEditionId` (same target wiring as `promoteEdition`); an "enter manually"
    toggle is the fallback and **clears** `targetEditionId` (decouple).
  - **Fitness branch** synthesizes a race-shaped target on exit — a `distanceKm`
    pick, a horizon via `addWeeks` (`src/utils/format.js`), and a goal from
    `suggestedGoalSec` — so `buildPlan` always has a timeline (no empty dashboard).
    `targetEditionId` stays unset (auto-detect correctly never fires).
- The **Health & safety** step is the **unskippable** medical-disclaimer +
  screening gate and the only way into the app (header "Skip" jumps *to* it, never
  around it). `summary` is an **in-memory-only** celebration *after* the gate;
  passing the gate advances to it and **`summary`'s "Get started" is the sole
  caller of `onComplete`**, which records `settings.healthAck = {v:
  DISCLAIMER_VERSION, at}` and a plan (built in `RunningCoach.jsx` from the merged
  race fields, incl. `targetEditionId`). The screening answer is GDPR health data —
  local state only, never persisted. Gated by `settings.onboarded` (+ legacy
  `settings.name`); set `onboarded: true` on any first-run completion/dismissal.
- Onboarding **persists per-step** via `onSaveProgress`: each step saves its data,
  the `intent`, and an `onboardStep` index into the active branch sequence —
  **capped at the health step** (`summary` is never persisted), so a refresh on the
  summary resumes at the gate and `healthAck` is always captured fresh. A set
  `onboardStep` (with `!onboarded`) means "in progress, resume" — don't key
  first-run detection on `name` alone. Clear the scaffolding (`onboardStep: 0`,
  `intent: null`) on complete/skip so it doesn't linger in the synced blob.
- `LogView` accepts a `prefill` prop and an `onSaved` callback (fires only on a
  real manual save, not CSV import/cancel) — used to log a run straight from a
  plan session and auto-tick it.
- **Settings fields auto-save** — the name and heart-rate inputs in
  `SettingsModal.jsx` / `HRZones.jsx` commit on blur/Enter via `saveSettings`
  (no Save buttons), following the commit-on-blur pattern in `GoalConfigurator`.
  Keep number fields as local string state and coalesce in the `commit` handler,
  not in `onChange`.
- **Settings = configure, not analyse.** `SettingsModal` sections, in order:
  **Profile** (name + the `HRZones` HR editor, all "about you"), **Privacy**,
  **Backup & restore**, then **Account** (destructive actions last). `HRZones`
  is the lean *editor* (inputs + "I don't know my heart rate" helper + a compact
  `HRZoneBar` preview) and renders **without its own card** so it nests in the
  Profile card. The full zones reference (table + Karvonen explainer + recent-run
  zone analysis) lives in **Progress → Stats** as `HRZonesCard`. `HRZoneBar`
  (the slim colour bar) is shared by both so they don't drift; HR-to-zone
  classification is the pure `runZoneIndex` in `src/utils/hr.js`.

## Git / PR workflow
- Do not open or merge PRs unless explicitly asked.
- We squash-merge PRs. After a squash-merge, a branch that keeps being reused
  **diverges from `main`** and the next merge hits a conflict. Before merging
  again on the same branch: `git fetch origin main && git rebase origin/main`
  (the old squashed commit is auto-skipped), then `git push --force-with-lease`.
