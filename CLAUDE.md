# Running Coach

A React 19 + Vite single-page running-training app. State is client-side and
mirrored through `db` into an in-memory cache that debounce-upserts to a single
per-user Supabase `app_state` JSONB row. It's failure-tolerant: a failed load
falls back to an empty cache so the app still renders.

## Maintaining this file
Keep this file lean and current: durable, cross-cutting rules only. Deep
per-feature detail lives in `docs/` (index at the bottom) — when you learn
something durable, put a one-line rule here only if it applies across tasks;
otherwise update the relevant `docs/` file in the same change. Record reusable
rules, not a changelog; delete anything stale.

## Setup & commands
- A Claude Code SessionStart hook (`.claude/hooks/session-start.sh`) runs
  `npm install` automatically in web sessions. In any other fresh checkout run
  `npm install` first — deps are not committed, so everything below fails with
  module-not-found until you do.
- `npm run dev` — Vite dev server.
- `npm test` — Vitest (run mode); `npm run test:watch` for watch. Suite lives
  in `src/**/*.test.{ts,tsx}`.
- `npm run lint` — ESLint (flat config). Catches unused imports/vars; keep it clean.
- `npm run typecheck` — app TS check; `npm run typecheck:supabase` — Deno check
  for edge functions; `npm run typecheck:all` — both (CI runs this).
- `npm run build` — production build (runs `typecheck` first) → `dist` for
  S3/CloudFront.

## TypeScript
- App source and tests live in `src/**/*.{ts,tsx}`; no new `.js`/`.jsx` in
  `src/`. Use `.tsx` only for files containing JSX.
- **Stay on TypeScript 6.x**: `typescript-eslint` doesn't support the TS 7
  native compiler yet. Don't bump `typescript` past 6.x in a routine dependency
  update until it declares TS 7 support.
- No file-level `// @ts-nocheck` in app source; prefer narrow local
  aliases/interfaces when a module needs incremental typing.
- Edge-function entrypoints are Deno TypeScript (`deno check` via
  `npm run typecheck:supabase`); keep Deno-specific code out of the browser
  ESLint config.

## Architecture
- **Entry gate (`src/App.tsx`):** one branch on the auth session. Signed-out
  web gets the lazy marketing chunk (`src/marketing/MarketingGate.tsx`) wrapped
  in `ChunkLoadBoundary` (fallback: the static `LoginScreen`; swallows only
  chunk-load errors) — keep any future top-level `lazy()` gate behind this same
  pattern. Web-only-and-heavy code goes behind the build-time
  `import.meta.env.VITE_NATIVE_BUILD` flag (constant-folded out of native
  builds), not a bare `isNative` runtime check, which still ships the code in
  the APK. Marketing copy commitments, SEO, and the brand mark:
  `docs/marketing.md`.
- **No router.** `src/RunningCoach.tsx` is the single state hub: it owns
  `runs`, `plan`, `settings`, modal flags, and the active `tab`, and passes a
  `shared` props bag down to every view; views switch on `tab`. Nav: Record is
  a center FAB (an action, not a destination); the four row tabs are Home ·
  Plan · Races · Progress. To add cross-view state or an action, define it
  there and add it to `shared` (e.g. `goTab`, `goLog`, `addRuns`).
- **Layout:** views in `src/views/`, modals/full-screen flows in `src/modals/`,
  reusable widgets in `src/components/`, pure helpers in `src/utils/`.
- **Persistence:** `db.get/set(STORAGE_KEYS.*)` (`src/db.ts`,
  `src/constants.ts`). Every state change is mirrored to `db` in the same
  handler that calls `setState`. Writes debounce ~600ms into a single upsert
  and flush on page hide/unload.
- **Supabase config:** URL + anon key in `src/config.ts`.
  `VITE_SUPABASE_URL` is required at build time; workflows construct it from
  repo variable `SUPABASE_PROJECT_REF`. Don't hardcode project refs or
  credentials anywhere else.
- **Migrations are append-only** once a version may have reached Supabase:
  never rename/remove a pushed `supabase/migrations/*.sql` version — keep a
  no-op marker and put real schema in a later migration.
- **Multi-user:** open public signups — no single-user assumptions; per-user
  isolation via RLS on `app_state` and `profiles`.
- **Plan building:** `buildPlan(raceDate, goalSec, planSessions, distanceKm,
  raceElevation, opts)` (`src/utils/plan.ts`) is the one plan author. Style
  pace multipliers live in `supabase/functions/_shared/coach/styles.mjs`
  (app re-export `src/utils/planStyles.ts`) — never hardcode the ratios.
  Every buildPlan call site must pass `style: settings.planStyle` (a missed
  site silently rebuilds as `balanced`, whose output is frozen by snapshot
  tests). New styles must stay validator-clean by construction
  (`coachValidation.test.ts` matrix). Rebuilds that replace an existing plan go
  through `carryProgress` so done/skipped aren't wiped. Detail (opts, long-run
  scaling, fitness level, suggested days): `docs/training-plan.md`.
- `raceDate`, `distanceKm`, `goalSec` start **empty** (`""`) — no seeded race
  defaults; guard before reading them.
- **Derived-state resets happen during render, not in effects** — see the
  `if (plan !== prevPlan)` pattern in `PlanView.tsx`. Related: no sync setState
  in effects (the `react-hooks` rule); reconcile in event handlers.
- **Telemetry:** everything goes through the vendor-agnostic seam
  `src/telemetry/index.ts`; only `src/telemetry/posthog.ts` imports the SDK
  (dynamic import, no-op until `VITE_POSTHOG_KEY`). Consent is opt-in,
  per-device (`localStorage`, not the synced blob). Autocapture and session
  recording stay OFF. Read `docs/telemetry.md` before adding/swapping a
  provider or an event.

## Live run tracking (GPS)
- **Single GPS funnel:** `src/hooks/useRunTracker.ts` owns all geolocation
  (`watchPosition`), the start/pause/resume/stop state machine, moving-time
  accounting, wake lock, and a `localStorage` recovery buffer (`LIVE_RUN_KEY`,
  deliberately NOT synced to the app_state blob). Keep GPS access behind this hook
  so a future native shell can swap the source without touching the UI.
- **UI:** `src/modals/LiveRunTracker.tsx` (full-screen, gated by `showTracker` in
  `RunningCoach`, opened via `shared.openTracker`). On finish it funnels into the
  normal save path — `goLog(prefill)` → `LogView` → `addRuns` — passing measured
  `durationSec`/`elevation` and the trace ref.
- **Traces are NOT in the blob.** The polyline lives in its own Supabase
  `run_routes` table via `src/routes.ts` (direct queries, not `db`); a run only
  stores a `routeId` reference. `deleteRun` cascades to `deleteRoute`; backup/
  restore include routes. Offline saves queue in `localStorage` and relink on next
  load via `flushPendingRoutes` (run carries a temp `routeTmp`/`routePending`).
  The `run_routes.stats` JSONB is a free-form sidecar: besides the summary
  `{km,durationSec,elevation,avgPace}`, a run also stores its **raw
  ~1Hz HR stream** there as `stats.hrSamples: {bpm,t}[]` (kept raw, NOT projected
  onto GPS points, so HR fidelity is decoupled from `simplify()`'s point
  thinning). Sources: a BLE-strap run (`LiveRunTracker.handleSave` from
  `rt.hrSamples`), a HealthKit import (Apple Watch route + HR series), a Health
  Connect import (HR series, no route), and file imports (GPX/TCX/FIT HR). All
  imports funnel through `persistImportedRoute` (`src/imports/persistRoutes.ts`),
  which folds `ImportedRun.hrSamples` into the sidecar; the two pure cleaners for
  raw native payloads are `normalizeRoutePoints`/`normalizeHrSamples`
  (`src/imports/series.ts`). **A run with GPS points rides `routeId`; an HR-only
  sidecar (HR but no route — the common Health Connect case) rides a SEPARATE
  `hrRouteId`** so History's map button (gated on `routeId`) never offers a blank
  map, while `RunDetailModal` still fetches it (`useRouteTrace` resolves
  `routeId ?? hrRouteId`) to draw the HR chart + time-in-zone card (that card is
  NOT gated on GPS). `deleteRun` cascades both; `LogView` prefill carries
  `hrRouteId`. Unknown JSONB key → forward/backward safe, and backup/restore/
  pending-queue carry it free. To store more per-run series later, extend this
  sidecar rather than widening the 4-tuple.
  Because that stream can be hundreds of KB on a long run, `getRoute(id,
  withStats)` / `useRouteTrace(run, {withStats})` gate the `stats` fetch:
  map-only surfaces (History's route preview) pass `false`, only `RunDetailModal`
  passes `true`. Keep new map-only consumers on `withStats:false`.
- **Per-run analytics (`src/modals/RunDetailModal.tsx`):** tap a run in History or
  the Dashboard recent-runs list (`RunRow` gained an optional `onClick`; hub seam
  `shared.openRunDetail`, guarded on arg shape) → full-screen map + a combined
  elevation/pace/HR `ComposedChart` (toggleable series) + per-km split table + HR
  time-in-zone card + stat tiles. All chart/table data is derived at render by
  **pure, tested helpers**: `buildRunSeries` (`src/utils/runSeries.ts`, cumulative
  distance + smoothed pace + timestamp-aligned HR), `buildSplits`
  (`src/utils/runSplits.ts`), and `timeInZones` (`src/utils/hr.ts`, reuses
  `runZoneIndex`/`HR_ZONES`). Both series helpers share ONE gap-aware
  cumulative-distance walk, `flattenTrack` (`src/utils/geo.ts`) — don't re-roll a
  third. **Pace smoothing uses a rolling ~200m DISTANCE window, not a time window:**
  stored points are Douglas-Peucker-thinned so they're sparse/uneven in time, and a
  fixed time window left pace null (an intermittent line) on straight sparsely
  sampled stretches. The trace is fetched via the shared `useRouteTrace` hook
  (`src/hooks/`, extracted from History's `RouteMapLoader`). The derived
  chart/table/zone data is `useMemo`'d on the trace (the modal re-renders on
  unrelated hub state + every toggle click).
  **Chart gotchas:** the distance x-axis MUST be `type="number"` (post-`simplify`
  points are unevenly km-spaced; a categorical axis misplaces them), and every
  series needs its own `yAxisId` matching a `<YAxis>` (recharts errors otherwise)
  — both guarded by the render test in `RunDetailModal.test.tsx`. HR series/cards
  render only when `stats.hrSamples` is present (degrade gracefully otherwise).
  **Chart↔map link:** the map passes `endpoints` (distinct start/finish markers,
  replacing the live head dot) and a `highlight` point; hovering/tapping the chart
  sets a `cursor` (a single nullable **index**, derived-during-render + clamped to
  the trace), and `RunChart` (now `memo`'d, with a stable `onCursor`) reports
  recharts' `activeTooltipIndex`. **Gotcha:** recharts v3 hands that index back as
  a STRING (`String(clampedIndex)`) for Line/Area/Composed charts, so coerce it
  through `activeIndexFromChartState` (a `typeof === "number"` check is always
  false → a permanently-null cursor). This works ONLY because `buildRunSeries` and
  `flattenTrack` emit one row per real point in the same order, so `series[i]` and
  `flat[i]` are the same point — an invariant locked by a test in
  `RunDetailModal.test.tsx`. Use the index, never `activeLabel` (float-matching the
  numeric axis). The exported `Readout` shows the highlighted point's stats with a
  fixed min-height (no layout shift); `onPick` maps a map tap back to the nearest
  `flat` point.
- **Geo math:** `src/utils/geo.ts` (haversine, jitter-gated `distanceKm`,
  hysteresis `elevGainM`, Douglas–Peucker `simplify`, `segments`). A point is the
  tuple `[lat, lng, tEpochMs, alt|null]`; a `null` entry is a GAP marker (don't
  bridge it). Map basemap is MapTiler — needs `VITE_MAPTILER_KEY` (records fine
  without it, just no tiles).
- **`RouteMap` (`src/components/RouteMap.tsx`) is the ONE shared map** (imperative
  Leaflet via refs, no react-leaflet, all markers inline SVG/CSS divIcons — no PNG,
  CSP/native-WebView-safe). Additive props default inert so History/LocationPicker
  are untouched: `endpoints`/`highlight`/`onPick` drive the run-detail chart link
  (above). **Live nav-follow:** `follow` auto-centres the head, but a user pan/zoom
  suspends it (`dragstart`/`zoomstart`, guarded against our own `programmaticSetView`
  via a ref so a synchronous `setView({animate:false})` isn't read as a gesture),
  reported via `onFollowingChange`; bumping `recenterSignal` snaps back to the head
  at `LIVE_DEFAULT_ZOOM` and re-arms follow. `LiveRunTracker` keeps the live map
  `interactive`, shows a recenter FAB while `!following`, and bumps `recenterSignal`
  on `visibilitychange`→visible (screen unlock / app foreground) — the requested
  zoom reset on return from a locked screen. New primitive-keyed effects
  (`[highlight?.lat, highlight?.lng]`, `[recenterSignal]`) sit AFTER the track
  effect so they layer on top and never fight the polyline redraw.
- **Phase 2 — native background tracking:** browser tracking is foreground-only
  (screen must stay on). True background recording runs in the **Capacitor
  shells** (Android + iOS) that swap the GPS source behind `useRunTracker`'s
  interface. The hook never touches `navigator.geolocation` directly anymore —
  it goes through `geoSource` (`src/geo/source.ts`), which picks `webSource`
  (`src/geo/web.ts`, `navigator.geolocation`, unchanged web behaviour) or
  `nativeSource` (`src/geo/native.ts`: @capacitor-community/background-geolocation
  — Android foreground service / iOS background location mode — for
  `background:true`, @capacitor/geolocation for the idle preview). Selection is
  by `isNative` (`src/native.ts` → `Capacitor.isNativePlatform()`), which also
  sets `window.__NATIVE_SHELL__` for the UI; `platform`/`isAndroid`/`isIos`
  (same module) gate platform-exclusive integrations (Health Connect vs
  HealthKit) — a synced preference naming the other platform's integration must
  degrade to "off" locally, never render its UI. **One bundle serves all**
  web + shells; `isNative` is false in any browser, so the web build is unchanged
  — keep it that way. To add a GPS source, implement the
  `isAvailable / watchPosition(onPos,onErr,{background}) / clearWatch` interface and
  hand `onPos` a `{coords:{latitude,longitude,altitude,accuracy}, timestamp}` object
  (see `adaptBgLocation`). Native auth uses a deep link (`AUTH_DEEP_LINK` in
  `src/supabase.ts`, completed in `App.tsx`; Android intent filter +
  `CFBundleURLTypes` in `ios/App/App/Info.plist`). Build: `npx cap sync
  android|ios` then `.github/workflows/release.yml` (one `v*` tag ships both
  stores); the web S3/CloudFront deploy stays untouched.
- **iOS shell (`ios/`):** Capacitor 8 generated an **SPM** project (no
  CocoaPods) — `cap sync ios` rewrites `ios/App/CapApp-SPM/Package.swift` and
  correctly excludes the Android-only pianissimo Health Connect plugin (no
  `Package.swift`/ios dir). It runs fine on Linux; only `xcodebuild` needs a Mac.
  Commit the Xcode workspace `Package.resolved`. SwiftPM can retain an old
  background-geolocation manifest by package identity after an npm upgrade; if
  it reports a Capacitor 7/8 constraint conflict, reset package caches or resolve
  with fresh DerivedData rather than replacing Capacitor's generated package path.
  App-local Swift plugins are NOT auto-registered: `MainViewController.swift`
  (the storyboard's custom class) registers `HealthKitBridgePlugin` in
  `capacitorDidLoad()`. New Swift files must be hand-added to
  `project.pbxproj` (build-file + file-ref + group + sources phase);
  `ios-pr.yml` (no-signing Simulator build on PRs touching `ios/**`) is the
  compile check. Info.plist owns the permission strings, `UIBackgroundModes`
  (`location`, `bluetooth-central`), the deep-link scheme, and
  `ITSAppUsesNonExemptEncryption=false`; `App.entitlements` carries the
  HealthKit capability.
- **Gotcha — Android permission prompt silently no-ops when Location Services
  are off:** `@capacitor/geolocation`'s `checkPermissions()`/`requestPermissions()`
  are gated *by the plugin itself* on the device's system Location toggle — they
  **reject immediately if it's off, before ever showing the OS permission
  dialog**. Relying on those alone (as `ensureForegroundPermission` in
  `src/geo/native.ts` used to) means a user with location off never sees any
  prompt at all — not the permission dialog, not a "turn on location" one.
  `getCurrentPosition()`/`watchPosition()` aren't gated that way: they request the
  runtime permission themselves, then (via Google Play Services) surface the
  system "turn on device location" dialog if needed. `ensureForegroundPermission`
  uses `checkPermissions()` only as a fast-path "already granted" check and falls
  back to a real `getCurrentPosition()` probe — the one call that can actually
  show both dialogs — whenever that check doesn't succeed.
- **Gotcha — precise vs approximate location hinges on `enableHighAccuracy`.**
  On Android 12+ the `@capacitor/geolocation` plugin picks the runtime permission
  from `enableHighAccuracy`: `false` requests the COARSE-only alias, so the OS
  dialog never shows the "Precise" toggle and the user can only grant
  *Approximate* — the "can't request precise location" bug. Run tracking needs
  FINE GPS, so `ensureForegroundPermission(highAccuracy)` defaults to `true` and
  the run-tracking call sites (`requestPermissions`, the background watcher) pass
  `true`; only Discover's "races near me" one-off passes `false` (approximate is
  enough — don't over-ask). The fast-path "already granted" check is
  accuracy-aware (`isFineGranted` for a precise ask, `isGranted` for coarse) so a
  user who previously granted only Approximate is routed back through the probe to
  re-offer precise instead of being pinned to approximate forever. A resolved
  probe still returns `true` even if the user picks Approximate — choosing it
  degrades accuracy, it never blocks the run.
- **Foreground location only — no `ACCESS_BACKGROUND_LOCATION`.** Screen-off
  recording works via the background-geolocation **foreground service** (started
  while the app is visible) under the "while using the app" grant, so the app
  deliberately does NOT declare or request `ACCESS_BACKGROUND_LOCATION`: the
  plugin never requests it (its `@Permission` alias is COARSE+FINE only), and on
  Android 11+ (~90% of users) it can only be granted via a Settings round-trip
  anyway — declaring it would just trigger Google Play's background-location
  review for no functional gain. Keep the "while using the app" wording in the
  disclosure/permission copy; don't reintroduce "Allow all the time".
- **`POST_NOTIFICATIONS` (Android 13+) is requested by the local `RunPermissions`
  plugin** (`android/.../RunPermissionsPlugin.kt`, registered in `MainActivity.java`),
  because neither geolocation plugin requests it and without it the foreground
  service's ongoing "recording run" notification is silently suppressed (the
  service still runs — recording is never blocked). The JS seam is
  `src/geo/notifications.ts`: `requestRunNotificationsOnce()` asks once per install
  (`REC_NOTIF_ASKED_KEY`) the first time a run starts — wired into
  `LiveRunTracker`'s `guardedStart` + `acceptDisclosure`, before the service starts.
  Below Android 13 it's a no-op (no such runtime permission).
- **Every native Start/Resume is gated on a live location check** (`guardedStart`
  in `LiveRunTracker`): after the disclosure, it `await`s `rt.requestPermissions()`
  (→ `ensureForegroundPermission`) and aborts if it returns false, so a run never
  enters the "tracking" state with a running clock and a blank map. That one call
  covers BOTH failure causes — permission not granted (OS prompt) and the device's
  Location Services switched off (the `getCurrentPosition` probe surfaces the "turn
  on location" dialog) — and on denial sets `tracker.errors.permissionDeniedNative`,
  which tells the user to do both. For a granted user with location on it fast-paths
  (a bare `checkPermissions()`, no dialog), so it's not a per-run nag. Don't drop
  this gate back to "start and hope" — the silent blank-map run was the bug.
- **npm dependency patches (`patches/`, applied by `postinstall` → `patch-package`):**
  native plugin modules compile straight out of `node_modules`
  (`android/capacitor.settings.gradle`), so a committed patch reaches every
  local and CI build. Current patch: `@capacitor-community/background-geolocation`
  crashed in production ("Unable to pause activity" → NPE at
  `Bridge.getPermissionStates`, Bridge.java:1217) because its
  `handleOnPause`/`handleOnResume` call `getPermissionState("location")` — the
  annotation-reflection path — on every activity pause/resume; the patch computes
  the same both-granted COARSE+FINE check via `ActivityCompat.checkSelfPermission`
  in a try/catch instead. The dependency is **pinned exact** (no `^`) so the
  patch always matches; on a version bump, check whether upstream fixed the
  lifecycle permission check (repo issue tracker was silent as of 1.2.26 and the
  plugin lags on Capacitor majors — see its issue #156), then regenerate
  (`npx patch-package @capacitor-community/background-geolocation`) or delete
  the patch.
- **Android release builds use R8:** `android/app/build.gradle` keeps
  `minifyEnabled true`, `shrinkResources true`, and the optimized default
  ProGuard file for `release`. Capacitor's consumer rules preserve annotated
  plugin entrypoints (the classes), but **not the `com.getcapacitor` annotation
  classes themselves** — and AGP 8's default R8 *full mode* strips runtime
  annotation data unless the annotation class is kept, which broke Capacitor's
  reflection-based permission machinery in production (NPE at
  `Bridge.getPermissionStates`, hit both by background-geolocation's lifecycle
  hooks — the `patches/` workaround — and by `Geolocation.checkPermissions()`/
  `watchPosition()` when the live tracker opens). Fix is two-layer:
  `android/app/proguard-rules.pro` keeps the Capacitor annotation classes +
  runtime-annotation attributes, and `android/gradle.properties` sets
  `android.enableR8.fullMode=false` as a safety net (removable only after the
  full tracker flow is verified on-device on a full-mode build). Add further
  narrow library-specific keep rules only when a release build or on-device
  test demonstrates a reflection requirement (checked: the ION geolocation AAR
  that @capacitor/geolocation 7+ wraps ships no consumer rules but does no
  reflection). Debug builds stay unminified; `android-pr.yml` also runs
  `bundleRelease` so PR CI compiles R8 (bad keep rules / missing classes) even
  though it only uploads the debug APK — but a green build does NOT prove runtime
  correctness: R8 stripping a reflectively-used class/method still builds
  successfully and only crashes on-device, so validate release behaviour on a
  device before shipping. Because the release AAB is obfuscated, `release.yml`
  uploads the per-build R8 `mapping.txt` (artifact `running-coach-mapping-<code>`)
  — it's the only way to deobfuscate native crash stacks (PostHog `captureError`)
  and is regenerated each build, so never rely on it surviving elsewhere.
## Native platforms (Capacitor shells)
- **One bundle serves web + both shells**; `isNative`
  (`src/native.ts`) is the runtime split and is false in any browser — the web
  build must stay unchanged by native work. `platform`/`isAndroid`/`isIos`
  gate platform-exclusive integrations; a synced preference naming the other
  platform's integration must degrade to "off" locally, never render its UI.
- **Seams:** all GPS goes through `geoSource` (`src/geo/source.ts`) behind
  `useRunTracker`; all external HR through `getHrSource` (`src/hr/source.ts`);
  all run imports through the provider registry (`src/imports/`). Add sources
  by implementing the interface — never touch `navigator.geolocation` or a
  native bridge directly from UI code.
- **Synced preferences vs per-device grants:** OS permissions and device
  pairings are per-install. A synced setting (`hrMethod`, `watchImport`) is a
  *preference*; check the local per-device marker before touching any native
  bridge.
- Detail, including the hard-won permission/signing/build gotchas:
  `docs/live-tracking.md` (GPS, shells, R8, patches),
  `docs/health-integrations.md` (HR, watch/file/cloud imports),
  `docs/background-location.md`, `docs/release.md` (stores, signing,
  versioning).

## AI coach agent
Propose-and-confirm plan **editor, never author** — `buildPlan` stays the
author. The Anthropic key, validator, tools, rate limit, and audit log live
server-side in `supabase/functions/coach-agent`; shared logic is plain ESM in
`supabase/functions/_shared/coach/*.mjs` (imported by both Deno and Vitest).
`confirm` makes no model call and no server write — the client applies the
returned plan via `applyCoachPlan`. The read-only `get_run_detail` tool serves
the model a compact, **coordinate-free** digest of one recent run (splits, HR
zones, downsampled series) built by `_shared/coach/runDigest.mjs` — ports of
`src/utils/{geo,runSeries,runSplits,hr}.ts`, parity-tested by
`src/utils/runDigest.test.ts`; keep the algorithms in sync at both ends and
never let lat/lng into a digest. **Read `docs/coach-agent.md` before
touching prompts, tools, validator rules, or the chat client** — it also covers
resiliency, usage limits, memory, history, and feedback. Evals: offline in
`npm test`; live-model in `evals/coach/` (`npm run eval:live`) — re-run after
prompt/tool-description changes.

## Data shapes
- **Run:** `{id, date, type, km, durationSec, hr, hrMax, elevation, effort,
  notes}` plus, for GPS-tracked runs, `{source:"gps", routeId}`; HR-only
  sidecar rides `hrRouteId`; transient post-run-HR markers are the
  per-platform fields `hrPending` / `hrPendingHk` (see
  `docs/health-integrations.md`). `id` is generated in `addRuns` if absent;
  runs are kept sorted newest-first.
- **Route:** `run_routes` row `{id, user_id, points, stats, created_at}`;
  `points` is the simplified `[lat,lng,t,alt]` array (null = gap marker),
  `stats` is `{km, durationSec, elevation, avgPace}` plus the free-form
  sidecar (e.g. `hrSamples`).
- **Plan:** `buildPlan(...)` → `{..., weeks:[{weekNumber, startDate, phase,
  sessions:[{id, date, type, desc, km, pace, done}]}]}`. Session types: EASY,
  TEMPO, INTERVALS, LONG, RACE, WALK, OTHER.

## Conventions
- **French and Spanish copy:** French uses informal `tu` (app copy in
  `src/i18n/`; marketing uses `vous` — see `docs/marketing.md`); Spanish stays
  region-neutral. Reserve `course` / `carrera` for organized races, `sortie` /
  `entrenamiento` for logged runs. No em dashes (`—`) in either locale.
  Enforced in `src/i18n/i18n.test.ts`.
- **Animations are CSS-only** (no library): keyframes + `--animate-*` tokens in
  the one `@theme` block in `src/index.css` (Tailwind v4 CSS-first, no
  `tailwind.config`). Transform/opacity-only and short. A global
  `prefers-reduced-motion` block degrades everything; behavioural changes use
  `usePrefersReducedMotion`. Enter animations re-fire by remounting via a
  changing `key`; modals animate enter-only; only the Toast animates exit (via
  `usePresence`).
- **Any new modal/sheet must call `useDismissable`** (`src/hooks/`) so Android
  back / web Escape close it via the LIFO registry
  (`src/utils/backDismiss.ts`). Register in the overlay's OWN component; pass
  the guarded close where one exists. `OnboardingWizard` deliberately does NOT
  register (unskippable gate).
- Reuse existing form pieces: `SessionConfigurator`, `GoalConfigurator`,
  `StylePicker`, `INPUT_CLS`/`LABEL_CLS` (`src/constants.ts`), type colors
  `TCLR`, day names `DAYS`, and the `fmt` helpers (`src/utils/format.ts`).
- Session "how it unfolds" breakdowns come from the pure `sessionSteps` helper
  (`src/utils/sessionSteps.ts`) — extend its parsers (and tests) for new desc
  formats rather than special-casing the UI.
- A logged run renders as `RunRow` (`src/components/RunRow.tsx`) — shared by
  dashboard + History; use its props (`dateFmt`, `showNotes`, `actions`,
  `highlight`) rather than re-rolling the markup.
- **Surfacing an async run change** (HR relink, watch import): go through
  `goToRuns(ids, label)` (`RunningCoach.tsx`) — transient highlight + navigate
  + scroll — not a bare text toast.
- Show whole-minute durations with `fmt.mins`, never `minutes / 60`.
- **Icon-only buttons need an `aria-label`** (plus `aria-pressed` for
  toggles); buttons with adjacent visible text don't get double-labeled.
- Number inputs: keep an emptied field empty while editing — no
  `parseFloat(v) || 0` in `onChange`; coalesce at use time. Settings fields
  auto-save (commit on blur/Enter), keeping local string state.
- **iOS safe-area insets:** any surface pinned to a screen edge must pad with
  the `--safe-top` / `--safe-bottom` CSS vars (`src/index.css`; 0 on
  web/Android) via inline `calc()`. Verify on a notched device.
- Tailwind utility classes inline; dark slate palette with orange-500 accents.
- Dates are `YYYY-MM-DD` strings; use `ymd()` and `fmt.*`
  (`src/utils/format.ts`). Parse local dates as `new Date(s + "T00:00:00")`.
- **Onboarding (`src/modals/OnboardingWizard.tsx`):** branches on
  `settings.intent` (`"race"` | `"fitness"`) via the pure `onboardingSteps`
  (`src/utils/onboarding.ts`). The **Health & safety** step is the unskippable
  medical gate — "Skip" jumps *to* it, never around it; only the summary's
  "Get started" calls `onComplete` (records `settings.healthAck`). The
  screening answer is GDPR health data — never persisted. Progress persists
  per-step via `onSaveProgress`, capped at the health step; clear
  `onboardStep`/`intent` on complete/skip. Set `onboarded: true` on any
  first-run completion/dismissal.
- `LogView` accepts a `prefill` prop and an `onSaved` callback (fires only on a
  real manual save) — used to log a run straight from a plan session and
  auto-tick it.
- **Settings = configure, not analyse.** Section order: Profile, Privacy,
  Backup & restore, Account (destructive last). Analysis surfaces (full HR
  zones reference) live in Progress → Stats.

## Git / PR workflow
- **Open a PR automatically when a task is finished** — committed, pushed, and
  lint/typecheck/tests green locally. This standing maintainer instruction IS
  the explicit opt-in. Exceptions: trivial/no-op changes, a PR already open for
  the branch (push to it instead), or the maintainer said to hold off. Mirror
  any `.github/pull_request_template.md` structure.
- **Never merge a PR unless explicitly asked.**
- **After opening a PR, track its CI and auto-fix failures:** call
  `subscribe_pr_activity`, then end the turn. On CI failure, investigate and
  push in-scope fixes until green; use `AskUserQuestion` for ambiguous or
  architectural calls; surface (don't go silent on) out-of-scope or
  non-converging failures. Green CI is the terminal state — report it.
- We squash-merge. A reused branch diverges after its squash-merge: before the
  next PR from the same branch, `git fetch origin main && git rebase
  origin/main` then `git push --force-with-lease`.
- PR APK builds are opt-in via the `apk` label on the PR (`android-pr.yml`);
  details + CI caching layout in `docs/release.md`.

## Deep-dive docs (`docs/`)
- `docs/marketing.md` — landing page, copy commitments, SEO, brand mark.
- `docs/training-plan.md` — buildPlan opts, methodology styles, fitness signal.
- `docs/release.md` — store releases, iOS signing, versioning/update gate,
  edge-function deploys, CI caching.
- `docs/live-tracking.md` — GPS pipeline, routes, native shells, permission
  gotchas, R8, npm patches.
- `docs/health-integrations.md` — HR sources, watch/file/cloud imports,
  dedupe rules, Health Connect/HealthKit.
- `docs/background-location.md` — Android background-location policy.
- `docs/races.md` — race catalogue, contributions, badges.
- `docs/coach-agent.md` — coach architecture, validator, evals, resiliency.
- `docs/telemetry.md` — analytics/crash-reporting seam and consent.
- `docs/integrations-polar.md` — Polar cloud import.
- `docs/monetization.md` — monetization direction.
