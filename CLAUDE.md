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
  `src/**/*.test.{ts,tsx}`.
- `npm run lint` — ESLint (flat config). Catches unused imports/vars; keep it clean.
- `npm run typecheck` — TypeScript project/syntax check for the Vite app.
- `npm run typecheck:supabase` — Deno typecheck for Supabase Edge Functions.
- `npm run typecheck:all` — app + Supabase typechecks; CI runs this.
- `npm run build` — production build; runs `typecheck` before Vite emits `dist` for S3/CloudFront.

## TypeScript
- App source and tests live in `src/**/*.{ts,tsx}`; do not add new `src/**/*.js` or
  `src/**/*.jsx` files. Use `.tsx` for files containing JSX, `.ts` otherwise.
- **Stay on TypeScript 6.x for now.** TS 7.0 is the native "Corsa" compiler port;
  `typescript-eslint` (`^8.63.0`) doesn't support it yet (peer range caps below
  7.0, and it crashes against the 7.0 compiler API — no stable programmatic API
  until 7.1). Don't bump `typescript` past 6.x in a routine dependency update
  until `typescript-eslint` declares TS 7 support.
- `tsconfig.json` runs normal project checking; do not add file-level
  `// @ts-nocheck` to app source. Prefer narrow local aliases/interfaces when a
  module needs incremental typing.
- Supabase Edge Function entrypoints are Deno TypeScript and are checked with
  `deno check` via `npm run typecheck:supabase`; keep Deno-specific code out of the
  browser ESLint config.

## Architecture
- **Entry gate (`src/App.tsx`):** one branch on the auth session. Signed-out
  **web** visitors get the marketing landing (`src/marketing/MarketingGate.tsx`,
  a `lazy` chunk) which opens the existing `LoginScreen` in a full-screen modal;
  signed-out **native** goes straight to `LoginScreen`. The lazy `MarketingGate`
  is wrapped in `ChunkLoadBoundary` (`src/components/ChunkLoadBoundary.tsx`)
  whose fallback is the statically-imported `LoginScreen`: a signed-in session
  never fetches the marketing chunk, so **sign-out** is the first time it loads,
  and a stale chunk after a mid-session redeploy (or a network drop) would
  otherwise reject the dynamic import straight into the app-wide `ErrorBoundary`
  and white-screen the app. The boundary swallows only chunk-load errors and
  re-throws genuine render bugs so they still reach `ErrorBoundary`. Keep any
  future top-level `lazy()` gate behind this same pattern. The runtime split is
  `isNative`; the **build-time** exclusion is `import.meta.env.VITE_NATIVE_BUILD`
  (set `"1"` only in `release.yml`'s web-build job and the native PR workflows) —
  it constant-folds `MarketingGate` to `null` so Rollup drops the whole marketing
  chunk from the APK/IPA (verified: zero marketing bytes in a native build). Keep anything web-only-and-heavy behind
  this same flag rather than a bare `isNative` runtime check, which still ships
  the code inside the APK. The landing's visual design is ported from the
  committed reference in `Marketing Page Design/` (a design-tool `.dc.html`
  export + screenshots — reference only, not built). It uses the **self-hosted
  Archivo** font (`@fontsource/archivo`, imported inside `MarketingGate` so the
  woff2s live in the web-only chunk and never hit the APK or need a Google-Fonts
  CSP entry) and real app **screenshots** in `src/marketing/assets/`. The hero
  phone frame shows `CoachChatMock`, a hand-built propose-and-confirm chat
  exchange (kept honest: the coach only *proposes*; Apply is the user's) — the
  AI coach leads the page per user feedback, and the mock avoids the beginner
  skew of the old home-screenshot hero (First-5K badge, "walk breaks welcome").
  Purpose-built mocks like it and `LiveTrackerMock` are the pattern when no
  suitable screenshot exists — screenshots are captured manually on-device, no
  retake tooling. (`BottomNav` is no longer overlaid in the marketing mock but
  stays an extracted shared component.) Copy commitments to keep true:
  methodology names on the plan card, the "no black box" session-breakdown
  line, the import strip (Strava/Garmin/Zepp via GPX/TCX/CSV *files* — never
  the Strava API; watch sync via Apple Health / Health Connect; **Polar** is the
  one direct *account* connect — keep Strava on the file side of that line), and
  the free-tier "daily fair-use limit" phrasing
  (deliberately non-numeric; `RATE_LIMIT_PER_DAY` is env-configurable). The
  free wording is "everything you need to train is free" — deliberately NOT
  "free includes everything", so a future premium tier of *new* features never
  contradicts the page; don't reintroduce the absolute phrasing. See
  `docs/monetization.md` for the monetization direction — durably: the app
  stays free; a future paid tier comes from *new* proactive-coach features,
  never from gating an existing free feature or lowering `RATE_LIMIT_PER_DAY`
  (the daily limit is cost-insurance, not a paywall lever). The footer
  carries a tip-jar link (`TIP_JAR_URL` in `src/constants.ts`, Buy Me a
  Coffee; empty string hides it) — it must only ever render inside the
  marketing chunk (web-only by construction): Apple rejects external payment
  links in the iOS app, so never surface it in native UIs. Marketing copy uses
  formal `vous` in French (the app-copy informal-`tu` rule applies to
  `src/i18n/` locales, not `src/marketing/`) — the ONE exception is the
  tip-jar link (`footer.support`, "Paye-moi un café"), deliberately informal
  `tu` because it's the developer's personal aside, not product copy; don't
  "correct" it back to `vous`. CTAs open
  `LoginScreen`; a secondary CTA links to the Play Store closed test
  (`PLAY_STORE_BETA_URL`); iOS beta CTAs use the public TestFlight opt-in
  (`TESTFLIGHT_BETA_URL`).
- **Marketing SEO is build-time only** (static S3/CloudFront, no SSR; CSP
  `script-src 'self'` forbids the inline-script pre-paint trick, so body content
  can't be prerendered into `#root` without a flash for signed-in users). The
  strategy lives in `index.html`: rich `<head>` (title, description, canonical,
  Open Graph + Twitter, JSON-LD — `application/ld+json` is a non-executable data
  block so it's exempt from the script-src CSP) for search snippets + social
  cards, plus a `<noscript>` marketing fallback for non-JS crawlers (flash-free —
  JS visitors never see it, `#root` stays empty until React mounts). Googlebot
  additionally renders the client marketing (`src/marketing/`). `robots.txt` +
  `sitemap.xml` + `og-image.png` are in `public/`. The OG image is a static
  1200×630 PNG generated from `scripts/og-image/template.html` filled with the
  shared `src/marketing/copy.json` (the single source of truth for the brand +
  hero headline — `MarketingGate.tsx` imports the same file, so the card can't
  drift from the page). Regenerate locally with `npm run og:image` (needs a
  Chrome/Chromium binary; found via `CHROME_BIN`, a Playwright chromium, or
  system paths); CI does it automatically — `og-image.yml` re-renders and commits
  the PNG on any change to `copy.json` or `scripts/og-image/**` on a feature
  branch, so the refreshed card reaches `main` with the copy change. Never
  hand-edit the committed PNG. All three web-only SEO assets are `rm`'d in
  `release.yml`'s web-build job before the per-platform `cap sync`s so they
  don't bloat the native packages. If robust non-Google
  crawling or LCP from static content is ever needed, the next step is bot dynamic
  rendering (CloudFront function) or splitting marketing to its own path — not
  prerendering into the shared `#root`.
- **Brand mark ("Pulse Stride"):** the logo is a heartbeat/pulse line rising
  into a finish dot (`polyline` + end `circle`, viewBox `0 0 220 120`). The one
  source for in-app/web usage is `src/components/BrandLogo.tsx` (inline SVG,
  `currentColor` — set colour with a text class); used by the app header
  (`RunningCoach`), `LoginScreen`, and `MarketingGate`. The **app-icon** variant
  is the mark in dark navy (`#0B1220`) on an orange background: `public/favicon.svg`
  (rounded square, browser tab), the Android **adaptive** launcher icon
  (`drawable-v24/ic_launcher_foreground.xml` vector + `@color/ic_launcher_background`
  = `#F97316`; the adaptive icon is all that's used since `minSdk 26`, so the
  legacy `mipmap-*/ic_launcher*.png` rasters are dead fallbacks), the Play
  Store 512 icon (`store-assets/play-store-icon.svg` → full-bleed square PNG via
  `npm run store:icon`; Play applies its own mask), and the iOS app icon (the
  same script also renders the 1024px opaque PNG into
  `ios/App/App/Assets.xcassets/AppIcon.appiconset/`; iOS applies its own mask,
  and App Store Connect rejects icons with alpha). Keep all these in sync if the
  mark changes. The iOS launch screen is a solid `#0f172a` frame in
  `LaunchScreen.storyboard`, matching the Android SplashScreen background.
- **No router.** `src/RunningCoach.tsx` is the **single state hub**: it owns
  `runs`, `plan`, `settings`, modal flags, and the active `tab`, and passes a
  `shared` props bag down to every view. The five views switch on `tab`
  (`dash`, `plan`, `log`, `history`, `stats`).
- To add cross-view state or an action, define it in `RunningCoach.tsx` and add
  it to `shared` (e.g. `goTab`, `goLog`, `addRuns`, `toggleSess`).
- **Persistence:** `db.get/set(STORAGE_KEYS.*)` (`src/db.ts`, `src/constants.ts`;
  keys `rc_runs`, `rc_plan`, `rc_settings`). Every state change is mirrored to
  `db` in the same handler that calls `setState`. Writes debounce ~600ms into a
  single upsert and flush on page hide/unload.
- **Supabase config:** URL and anon key live in `src/config.ts` (imported by
  `src/supabase.ts`). `VITE_SUPABASE_URL` is required at build time; GitHub
  workflows construct it from repo variable `SUPABASE_PROJECT_REF`. Env var
  `VITE_SUPABASE_ANON_KEY` can override the publishable key. Don't hardcode
  project refs or credentials elsewhere.
- **Migrations are append-only once a version may have reached Supabase.** Do not
  rename or remove a `supabase/migrations/*.sql` version after it has been pushed
  or previewed remotely: Supabase Preview/db-push checks require every remote
  migration version to exist locally. If a historical version was superseded,
  keep a no-op compatibility marker with that timestamp and put real schema in a
  later migration.
- **Deploying edge functions (via the Supabase MCP tools, not the CLI):** the
  project is **`run-app`**; use the project ref from the repo variable
  `SUPABASE_PROJECT_REF` rather than hardcoding it. To redeploy `coach-agent`
  after editing `supabase/functions/coach-agent/index.ts` or any
  `supabase/functions/_shared/coach/*.mjs`, go straight to
  `mcp__Supabase__deploy_edge_function` with that project id,
  `name: "coach-agent"`, `entrypoint_path: "source/index.ts"`, `verify_jwt:
  true`, and a `files` array of **exactly these six**, read fresh off disk
  (content must match current `git` state, not a stale copy from earlier in
  the conversation):
  `source/index.ts` ← `supabase/functions/coach-agent/index.ts`,
  `_shared/coach/engine.mjs`, `_shared/coach/validation.mjs`,
  `_shared/coach/tools.mjs`, `_shared/coach/mock.mjs`,
  `_shared/coach/styles.mjs` (same relative names,
  read from `supabase/functions/_shared/coach/`). Omitting `styles.mjs`
  breaks the function at boot — `tools.mjs` imports it. This naming is load-bearing:
  the entrypoint's `../_shared/coach/*.mjs` imports only resolve because
  `_shared` sits as a sibling of `source/` in the upload, mirroring the real
  `supabase/functions/` layout. No `list_edge_functions` / `get_edge_function`
  round-trip needed first — this recipe is already confirmed working (deployed
  successfully as version 5). `notify-contribution` is the only other function;
  redeploy it the same way with its own single `source/index.ts` (no
  `_shared` dependency) if it's ever changed.
  Large payloads occasionally drop the MCP connection mid-call (seen twice
  deploying `coach-agent`, ~60KB of files) — just retry `deploy_edge_function`
  verbatim; it's a transient reconnect, not a real failure. This sandbox's
  outbound proxy blocks arbitrary domains (`supabase.co` included), so a
  post-deploy `curl` smoke test isn't possible here — confirm via the deploy
  call's returned `status: "ACTIVE"` and, if you want request-level
  confirmation, `mcp__Supabase__get_logs` with `service: "edge-function"`
  instead.
  **On merge to `main`, this happens automatically instead** —
  `.github/workflows/deploy-supabase-functions.yml` diffs the push against
  the previous commit and runs `supabase functions deploy <name>` (the CLI,
  reading straight off disk — no inline-content payload) for whichever
  function directories changed, redeploying `coach-agent` if `_shared/**`
  changed too. Needs a `SUPABASE_ACCESS_TOKEN` repo secret (Supabase
  personal/service access token with deploy rights on `run-app`) and a
  `SUPABASE_PROJECT_REF` repo variable — the MCP recipe above is only for
  redeploying mid-session, before a merge.
- **Multi-user:** The app is open to public signups — don't make single-user
  assumptions. Every user gets their own isolated data via RLS on `app_state`
  and `profiles`.
- **App versioning / update gate (native only):** one platform-agnostic `v*` tag
  (e.g. `v1.4.0`) triggers `release.yml`, which builds the web bundle once and
  ships **both** stores in parallel — an `android` job (AAB → Play internal
  track) and an `ios` job.
  **Two ways to cut a release, both landing in the same build+upload jobs:**
  (1) **`workflow_dispatch`** — the mobile / no-desktop path. Open Actions →
  "Release mobile apps" → **Run workflow** (works in a phone browser at
  github.com; the GitHub *mobile app* can't dispatch). The `prepare` job
  auto-computes the next version from the latest `v*` tag (`bump` input:
  patch/minor/major, default patch; or type an exact `version`), builds +
  uploads, then the final `tag` job **creates the `v*` tag and a GitHub Release
  with `--generate-notes`**. `dry_run: true` builds only (no upload, no tag) —
  the old smoke-test behaviour. (2) **pushing a `v*` tag** from a desktop — same
  jobs; `prepare` reads the version from the ref and `tag` attaches a Release to
  it. A tag created by the workflow's `GITHUB_TOKEN` does **not** recursively
  re-trigger the `push: tags` path (GitHub suppresses that), so a dispatch
  release runs exactly once; the `tag` job needs `permissions: contents: write`.
  `prepare.outputs.is_release` (false only for a dry run) is the single switch
  every store-upload / Supabase-publish step gates on — it replaced the old
  per-step `startsWith(github.ref, 'refs/tags/v')` checks, so those must keep
  reading `needs.prepare.outputs.is_release`, and the version name for every job
  comes from `needs.prepare.outputs.version` (don't reintroduce per-job ref
  parsing). The rest of the pipeline is unchanged: the `android` job (AAB → Play
  internal track) and the `ios` job (xcodebuild archive → TestFlight). iOS uses
  **fully MANUAL distribution signing** — both the archive and the export sign
  with a manually created Apple Distribution certificate (a .p12 imported into a
  temp keychain: `APPLE_DIST_CERT_P12_BASE64` / `APPLE_DIST_CERT_PASSWORD`
  secrets; mint/renew it Mac-free with `npm run ios:dist-cert`, certs last 1 year
  and expiry only blocks new uploads) against an **App Store provisioning profile
  regenerated on every run** by `scripts/ios-appstore-profile.mjs`
  (`npm run ios:appstore-profile`; step "Create App Store provisioning profile").
  That script uses the SAME ASC API key (`ASC_API_KEY_P8_BASE64` /
  `ASC_API_KEY_ID` / `ASC_API_ISSUER_ID` secrets + `APPLE_TEAM_ID` repo var) to
  create an `IOS_APP_STORE` profile bound to the team's live distribution certs
  and installs it locally; the archive then pins
  `CODE_SIGN_STYLE=Manual` / `CODE_SIGN_IDENTITY="Apple Distribution"` /
  `PROVISIONING_PROFILE_SPECIFIER="Running Coach App Store CI"`
  (`IOS_BUNDLE_ID` + `APPSTORE_PROFILE_NAME` job envs are the single source —
  keep them in sync with `PRODUCT_BUNDLE_IDENTIFIER` and the script default).
  **Why manual, not Xcode automatic signing (the bug that broke a release):**
  automatic signing on an ephemeral runner has an empty keychain, so
  `-allowProvisioningUpdates` minted a fresh **Apple Development** certificate on
  EVERY archive; those accumulated until the team hit Apple's certificate cap and
  the archive failed with "reached the maximum number of certificates" →
  "No profiles … found". Manual distribution signing reuses the imported .p12 and
  never creates a certificate; App Store profiles are NOT capped, so regenerating
  one per run is free. Do NOT reintroduce automatic signing /
  `-allowProvisioningUpdates` on the archive. (The old "don't force
  `CODE_SIGN_IDENTITY` — conflicting provisioning settings" gotcha only applied to
  forcing an identity while the STYLE stayed Automatic; with the style also pinned
  to Manual there is no conflict.) A dry-run dispatch (`dry_run: true`) exercises
  the whole archive+signing path but skips the upload, so it's the cheap way to
  validate a signing change.
  Other iOS signing gotchas, all hit in practice: the ASC key must have the
  **Admin** role (App Manager fails with "Cloud signing permission error"); Apple's
  cloud-managed "Distribution Managed" certificate is REJECTED by App Store
  Connect ("Invalid Signature") on apps with embedded frameworks (all Capacitor
  apps — hence the manual .p12); and upload validation demands
  `NSHealthUpdateUsageDescription` in Info.plist even though the app never writes
  to Health — HealthKit framework presence alone triggers it, so keep that key
  when touching Info.plist.
  Build version is NOT in the DB — versionCode/CFBundleVersion is
  `run_number*1000 + run_attempt`, versionName/MARKETING_VERSION is the `v*` tag
  (`android/app/build.gradle` reads env; iOS gets xcodebuild command-line
  overrides). The `run_attempt` term matters: BOTH stores permanently reject a
  re-used build number, and a bare `run_number` repeats on "re-run failed jobs" —
  exactly what happens after a partial release. Seen in practice: run 45's retry
  re-sent versionCode 45 and Play rejected it outright. The two platform jobs
  are independent, so one store's failure never blocks the other; each job
  STAGES its OWN `app_config` pending column (`pending_version` for Android,
  `pending_version_ios` for iOS, via `supabase db query --linked` using
  `SUPABASE_ACCESS_TOKEN`) only after its upload succeeds, so a partial release
  never stages a version a store didn't get. **Upload ≠ publish:** staging never
  shows the in-app update banner (Play promotion/rollout and App Store review
  come after upload). The maintainer runs the manual **"Publish app version"**
  workflow (`publish-version.yml`, `workflow_dispatch`, phone-friendly) per
  platform once the store actually publishes — it promotes pending →
  `latest_version(_ios)` (refusing when nothing is staged; optional `version`
  input overrides for repair/rollback), and only THAT flips the update prompt
  on. Don't reintroduce a direct `latest_version` write in `release.yml`.
  `min_supported_version` /
  `min_supported_version_ios` (hard gates) are bumped by hand on a breaking
  change. `App.tsx` selects all four columns and compares the installed version
  (`App.getInfo()`) against its platform's pair via `versionStatus`
  (`src/utils/version.ts`); a failed check never blocks the user. iOS store
  links need `APP_STORE_URL` (`src/constants.ts`) filled in once the App Store
  record exists — the update prompt hides its button while it's empty.
  **Gotcha — never open the store link through `@capacitor/browser` on
  Android** (tapping "Update" crashed the app on-device): the plugin's Custom
  Tabs path only catches `ActivityNotFoundException` natively, so any other
  failure launching the tab kills the process. `openStore` (`UpdatePrompt.tsx`)
  instead does a plain top-frame navigation — Capacitor's WebViewClient
  intercepts external hosts (`Bridge.launchIntent`) and hands them to the OS
  as an `ACTION_VIEW` intent, which the Play Store app claims. Use the same
  pattern for any future Android outbound link that a native app should claim;
  `Browser.open` stays correct for iOS (SFSafariViewController, as in OAuth).
- **Derived-state resets are done during render, not in effects** — see the
  `if (plan !== prevPlan)` pattern in `PlanView.tsx`. Follow that style.
- **Telemetry (analytics + crash reporting):** all routed through one
  vendor-agnostic seam, `src/telemetry/index.ts`; the vendor (**PostHog**) lives
  behind it in `src/telemetry/posthog.ts`, the **only** file that imports an SDK.
  App code never imports the SDK directly. It's a **no-op until keyed**
  (`VITE_POSTHOG_KEY`; default host `https://eu.i.posthog.com`), and `posthog-js`
  is a **dynamic import** so it stays out of the main bundle / any keyless build.
  Consent is **opt-in** (EU/ePrivacy): nothing collected until the user accepts
  the first-run `ConsentBanner` (`src/components/ConsentBanner.tsx`, rendered in
  `App.tsx` over login + app); changeable in Settings → Privacy. The single
  source of truth is `localStorage` (`rc_telemetry_consent_v2`), **per-device** (NOT
  the synced blob — a fresh browser re-asks) and tri-state (`"1"`/`"0"`/absent =
  granted/denied/undecided; see `getConsentDecision`). The `ErrorBoundary`
  (`src/components/ErrorBoundary.tsx`, wraps `<App/>` in `main.tsx`) **auto-reports
  crashes on both web and native** whenever analytics consent is granted (the old
  native per-crash "Send report" prompt was removed); it still shows a crash
  screen with reload + copy/email-trace. `track`/`identifyUser` are consent-gated;
  `captureError` is gated by its call sites. **Standard web events: `$pageview` +
  `$pageleave` are ON** (core-bundled, CSP-safe, fire in the native WebView too);
  **autocapture, `capture_exceptions`, and session recording stay OFF** — the
  latter two lazy-load remote bundles our CSP blocks (crashes use the bundled
  `captureException`), and autocapture would leak race names/notes via `$el_text`.
  See `docs/telemetry.md` before adding/swapping a provider or an event.
- **Layout:** views in `src/views/`, modals/full-screen flows in `src/modals/`,
  reusable widgets in `src/components/`, pure helpers in `src/utils/`.
- `settings` is the central config object (race fields, HR profile, `planSessions`,
  `name`, `onboarded`). The training plan is (re)built by
  `buildPlan(raceDate, goalSec, planSessions, distanceKm, raceElevation, opts)`
  (`src/utils/plan.ts`). The `opts` object is additive (positional call sites keep
  working): `recentRuns` seeds a **fitness-aware** BASE start (longest run in the
  last ~5 weeks, clamped to the race-scaled peak) so a fit athlete isn't reset to a
  tiny long run; `mainEditionId` + `races` drive the **secondary-race overlay**.
  The long run is scaled to **race distance** (~0.9× for ≤half, ~30-32 km marathon,
  ≤36 km ceiling for ultras), NOT capped by the long-session minutes — so it can
  exceed the configured long-day duration; PlanView shows an honest nudge when it
  does. `plan.longRunPeakKm` exposes the peak for that nudge.
- **Methodology styles (`opts.style` / `settings.planStyle` / `plan.style`):**
  buildPlan composes weeks per style — `balanced` (default; the pre-styles
  algorithm, frozen byte-identical by snapshot tests in `plan.test.ts` — absent/
  unknown style resolves to it), `polarized`, `runwalk`, `lowfreq`, `hansons`.
  **Pace multipliers live in `supabase/functions/_shared/coach/styles.mjs`**
  (single source shared with the coach agent's `tools.mjs`; app re-export
  `src/utils/planStyles.ts` — never hardcode the ratios elsewhere); plan shape
  (long-run peak/taper/cutbacks), `STYLE_META` blurbs and the pure
  `recommendStyle` profile heuristic are app-side in `planStyles.ts`. New styles
  must stay validator-clean **by construction** (space hard days via
  `pickHardDays`; buildPlan's adjacency sweep demotes stragglers to EASY —
  balanced is exempt to preserve its output) — the matrix in
  `coachValidation.test.ts` enforces this across distances/day layouts. The UI
  seam is `StylePicker` (PlanView setup/edit + both onboarding branches):
  selection state is `StyleId | null` where null = "untouched, track the live
  recommendation"; a tap pins it. All buildPlan call sites must pass
  `style: settings.planStyle` (or the draft) — a missed site silently rebuilds
  as balanced.
- **Fitness signal & suggested days:** `settings.trainingLevel`
  (`"none"|"occasional"|"regular"|"frequent"`, synced) is onboarding's
  one-question self-report ("How much do you run right now?", `LevelTiles` in
  both branches, optional). It substitutes for run history ONLY when none
  exists: `recommendStyle` maps it to a synthetic weekly-km band (real logged
  runs always win) and `buildPlan`'s `opts.level` floors the starting long run
  (`levelStartLongKm`, capped at the race peak). `suggestPlanSessions(distance,
  level)` (`planStyles.ts`) provides default training days — minutes must come
  from `SessionConfigurator`'s fixed option set, the Sunday session strictly
  longest, quality days ≥2 from Sunday so `pickHardDays` places without
  demotions. Onboarding uses the same null-=-tracking pattern as the style
  (the stock Wed30/Sun60 default counts as untouched); PlanView offers it as a
  "Use suggested days" one-tap fill, never overriding a configured draft.
- **Multi-race plans (no user-facing priority):** the plan peaks/tapers for the
  **main** race (`settings.targetEditionId`, the "Training target"); other races the
  user flags with `participation.inPlan` are folded in as RACE sessions (id
  `race-{editionId}`) by `buildPlan` when before the target and inside the window.
  A *substantial* secondary race (≥ half the main distance) auto-gets a mini-taper
  week; a small one just drops in — the user picks nothing (no A/B/C). Toggling a
  race in/out goes through `setRaceInPlan` (`RunningCoach.tsx`), which rebuilds the
  plan **preserving done/skipped by session id** (`carryProgress`) so progress isn't
  wiped. Every RACE session is stamped with its `editionId`; race-day auto-detect
  (`detectAnyRace` in `src/utils/races.ts`) matches a logged run against **all** plan
  races, not just the target.
- `raceDate`, `distanceKm`, and `goalSec` start **empty** (`""`) — there are no
  seeded race defaults. Anything reading them before setup must guard (the
  Dashboard race card and Generate buttons gate on `raceDate && distanceKm`),
  not assume a value.

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
- **Geo math:** `src/utils/geo.ts` (haversine, jitter-gated `distanceKm`,
  hysteresis `elevGainM`, Douglas–Peucker `simplify`, `segments`). A point is the
  tuple `[lat, lng, tEpochMs, alt|null]`; a `null` entry is a GAP marker (don't
  bridge it). Map basemap is MapTiler — needs `VITE_MAPTILER_KEY` (records fine
  without it, just no tiles).
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

## Heart-rate sources (native HR capture)
- **Same seam shape as GPS.** External HR capture mirrors `geoSource`: `getHrSource`
  (`src/hr/source.ts`) returns a source or **null** (off / web / unknown / wrong
  platform), so the web build is unaffected (HR capture is native-only). Methods
  are platform-gated: `bluetooth` works on both shells, `healthconnect` is
  Android-only, `healthkit` iOS-only — the Settings picker comes from
  `hrMethodsForPlatform()`, and a synced off-platform method degrades to null.
  Two **narrow capability contracts**, not one fat interface — a source carries
  a `live` flag:
  - **Live** (`src/hr/ble.ts`, `bleSource`): a standard BLE Heart Rate Profile sensor
    (chest strap / armband / watch broadcasting, e.g. Amazfit "Heart Rate Push").
    `isAvailable / scan / requestPermissions / watch(onSample,onErr,{deviceId}) /
    clearWatch`. `useRunTracker` streams it **alongside GPS**; samples are `{bpm,t}`,
    appended only while `state==="tracking"` (mirrors `onPos`), summarised by
    `hrSummary` into `stats.{hr,hrAvg,hrMax}`, and persisted in the `LIVE_RUN_KEY`
    recovery buffer. Parsing of the `0x2A37` characteristic is the pure, unit-tested
    `parseHrMeasurement` in `src/utils/hr.ts` (takes the plugin/Web-Bluetooth DataView).
  - **Post-run** (`src/hr/healthconnect.ts`, `healthConnectSource`): reads HR from
    Android Health Connect after the run via **@pianissimoproject/capacitor-health-connect**,
    dynamic-`import()`ed lazily (not a static top-level import) so merely rendering the app
    can't touch the native Health Connect bridge — only actually using the source does.
    Chosen over the Cap-8-native flomentum plugin because its
    `readRecords({type:'HeartRateSeries'})` reads **continuous** HR over an arbitrary
    window — so the user does NOT also have to log a workout on the watch. Trade-off: its
    peer is `@capacitor/core ^7`, resolved via the package.json `overrides` entry so a
    normal `npm install` picks up Cap 8 (`--legacy-peer-deps` is deliberately avoided — it
    silently drops recharts' `react-is` peer); Cap-7 native almost
    certainly builds against Cap 8 (stable Android plugin API) but **must be confirmed by
    an on-device / CI Android build**. `useRunTracker` never streams it —
    `LiveRunTracker.handleSave` calls `fetchRange(start,end)` over the tracker's
    `startedAt`/`stoppedAt` window; on an empty result it stamps
    `hrPending:{start,end,source}` and `flushPendingHr` relinks on next load (the
    `flushPendingRoutes` deferred pattern), **never overwriting** an HR the user has since
    entered by hand. Pending HR markers are validated and expire after ~3 days;
    invalid/stale/manual-filled markers are cleared before touching the native Health
    Connect bridge. Boot-time retries may query Health Connect only when both the
    synced method is `settings.hrMethod === "healthconnect"` **and** this device has
    the local authorization marker (`HR_HEALTH_CONNECT_AUTH_KEY`) from a prior grant;
    a synced method alone is not enough because Android permissions are per-install.
    Actual reads re-check permission and clear the marker if revoked. Needs
    `READ_HEART_RATE` + a Play health-data declaration/privacy policy.
  - **HealthKit (iOS post-run, `src/hr/healthkit.ts` + `src/healthkit/`):** the
    iOS mirror of the Health Connect pair — `healthKitSource` (post-run HR
    fetchRange) plus a workout-import provider — backed by the local Swift
    plugin `HealthKitBridgePlugin` (raw values only; pure TS mapping in
    `src/healthkit/mapping.ts`, HK workout UUIDs ride `hcId` with an `hk:`
    prefix so the ONE dedupe rule set needs no changes). **Gotcha: HealthKit
    never reveals READ authorization** — there is no trustworthy
    checkPermissions; the per-device marker (`HK_AUTH_KEY`, `rc_hk_auth`, one
    marker for both HR and workouts — a single sheet grants both) is set when
    the request flow completes and cleared only on availability failure, never
    by a probe. Empty reads mean "no data", so runs just stay pending.
    **Pending markers are per-platform FIELDS:** Android stamps `run.hrPending`,
    iOS stamps `run.hrPendingHk` — separate because already-shipped Android
    builds clear any `hrPending` whose source isn't "healthconnect", so an iOS
    marker there would be destroyed through the synced blob. The shared engine
    `src/hr/pending.ts` triages one field per flusher (`flushPendingHr` /
    `flushPendingHkHr`, both called at RunningCoach's boot + foreground sites,
    whose patch clears both fields — a run only ever carries one marker); never
    move iOS markers back into `hrPending`. The HealthKit provider deliberately
    has NO `disconnect` — its auth marker is shared with post-run HR, so
    clearing it on watch-import "Turn off" would break `hrMethod:"healthkit"`.
    Per-workout HR aggregates in Swift use `HKQuery.predicateForObjects(from:
    workout)`, never a bare time window. Both health-store import providers
    share the synced `settings.watchImport` flag via
    `providerEnabledInSettings` (`src/imports/registry.ts`).
- **Method preference syncs; the device does NOT.** `settings.hrMethod`
  (`"off"|"bluetooth"|"healthconnect"|"healthkit"`) is in the synced blob; the bonded BLE device
  `{id,name}` is **per-device localStorage** (`src/hr/device.ts`, `HR_DEVICE_KEY`) —
  like the consent / bg-disclosure flags — because Bluetooth bonding is per-phone.
  Treat the synced method as a preference only: before using it, derive local
  readiness from the per-device state (`getPairedDevice()` for Bluetooth,
  `hasHealthConnectAuthorization()` for Health Connect). `LiveRunTracker` uses an
  effective method (`"off"` when the selected source is not ready here) and prompts
  the user to pair/authorize in Settings before Start, without blocking the run.
  Config UI is the unified **`ConnectionsCard`** (`src/views/ConnectionsCard.tsx`,
  its own Settings card — it replaced the old `HrSensor` + `Integrations`
  sections, which surfaced Health Connect twice): a BLE-sensor row, ONE
  health-store row per platform (Health Connect / Apple Health) whose sub-toggles
  write `hrMethod` and `watchImport`, registry-driven cloud rows (Polar), and on
  web a single "in the mobile app" pointer (store links) instead of disabled
  native rows — never render the OTHER mobile platform's store row. A fresh
  health-store grant auto-enables watch import and — only when `hrMethod` is
  `"off"` — post-run HR; it never silently replaces a configured method (BLE or
  one synced from another device). BLE pairing reuses the disclosure→OS-prompt
  pattern (`HrSensorDisclosure`, `HR_BLE_DISCLOSED_KEY`). A skippable nudge (in
  `LiveRunTracker`) offers setup on run start while HR is off; it reappears each run
  until the user sets HR up or taps "Don't record heart rate", which sets the synced
  `settings.hrOptOut`. It never blocks Start.
- HR lands in the **existing** run `hr`/`hrMax` fields (no shape change) via the
  `LogView` prefill — still user-editable — so all HR display (`HRZonesCard`,
  `runZoneIndex`, Stats) works unchanged.

## Watch run import (phone-free runs)
- **For runners who leave the phone at home** (e.g. Garmin Forerunner, Amazfit):
  import a *finished* run's stats (distance, duration, elevation gain, avg/max HR)
  after the fact, instead of live GPS. Native-only, opt-in (`settings.watchImport`).
- **All import sources go through the provider registry** (`src/imports/`):
  `types.ts` defines `ImportProvider` (+ `ImportedRun` = `Partial<Run>` with
  transient route `points` the *caller* persists via `saveRoute` and strips before
  `addRuns`); `registry.ts` lists providers and `scanAllProviders` merges scans
  with **cross-provider dedupe** (`dedupe.ts` `isDuplicateRun`: hcId/extId
  id-spaces, `startedAt` window overlap, fuzzy date+10%-km) so the same run from
  two sources collapses. Adding an integration = implement the interface +
  register it; the toast/goLog/addRuns pipeline needs no changes. Three providers:
  **healthConnect** (wraps `src/watch/`, deliberately brand-agnostic — one
  "Watch" entry for Garmin/Zepp/etc., brand stamped into run notes via
  `dataOrigin.ts`), **file** (CSV via `parseRunsCsv` + GPX/TCX via
  `src/utils/gpx.ts` + **FIT** via `src/utils/fit.ts`, works on web; GPX/TCX/FIT
  return route `points` → LogView saves them so imported files get maps).
  **FIT is binary**, so `LogView.handleFile` reads a `.fit` as an ArrayBuffer and
  passes `bytes` (not `text`) into the provider `parse`; `fit.ts` is a
  dependency-free decoder (like `gpx.ts`) that pulls `record` messages and reuses
  the shared `activityToRun` reducer so a FIT map/stats agree with a GPX one. FIT
  is the recommended full-fidelity path for Zepp runs (HC drops route/elevation):
  export the activity from Strava's "Export Original" (the .fit Zepp uploaded) or
  Export GPX — the in-app import help (`log.import.perActivity`) spells this out.
  **cloud** — vendor cloud APIs (OAuth + server-side pull). **Polar**
  (`providers/polar.ts`, the first real one — `docs/integrations-polar.md`) works
  on **web AND native** and is **dormant until configured**: the secret half
  lives in the `polar-import` edge function + `polar_tokens` table
  (service-role-only, token never reaches the client), and the provider's
  `isAvailable()` is false without `VITE_POLAR_CLIENT_ID` (wired into
  `deploy.yml`/`deploy-pr.yml` AND `release.yml`/`android-pr.yml` — native builds
  inline it at web-bundle build time) — so it ships as a safe no-op, like
  `garminCloudProvider` (`providers/cloud.ts`, still scaffold-only). The edge
  function returns each exercise's raw **GPX**, parsed **client-side** by the
  app's existing `parseActivityFile` so a Polar run gets the same detail a
  user-picked `.gpx` does. `completePolarAuth()` (RunningCoach boot + the
  `rc-polar-return` event) finishes the OAuth return, gated on a `state` marker
  so it never collides with Supabase's own `?code=` PKCE flow. **Native OAuth is
  a bounce**: Polar has ONE registered https redirect (the web origin), so a
  native connect marks its state `polar_import:native:<nonce>`, opens the system
  browser (Android via plain top-frame navigation / Bridge.launchIntent — never
  `@capacitor/browser` there; iOS via `Browser.open`), and the returning web
  page's `polarPreinit` forwards code+state to the
  `solutions.camboulive.run://polar-callback` deep link (scripted redirect +
  always-rendered tap fallback, since browsers gesture-gate custom-scheme
  navigation). `App.tsx` must route that deep link BEFORE its Supabase
  auth-code exchange (it also carries `?code=`); handshake values live in
  localStorage on native (sessionStorage dies with the killed app), and
  `completePolarAuth` only clears the stash when a code is actually consumed —
  wiping the nonce on a codeless boot would reject an in-flight return. The
  exchange passes the SAME https redirect_uri (`WEB_APP_ORIGIN`), never the
  WebView origin. Provider order for the next cloud
  integrations (Suunto, COROS): reuse this seam. **Strava API is deliberately
  excluded**: its agreement bans AI-model use of API data and the coach reads
  runs — users' own CSV/GPX exports are fine, that's data portability, not the
  API. Polar's agreement has no such clause (the reason it's the pilot). There is
  **no usable Zepp cloud API** for indies (official one is corporate-partner
  only); password-based scraping libs are ToS-violating — Amazfit rides Health
  Connect or files.
  Settings UI is the unified `src/views/ConnectionsCard.tsx` (registry-driven for
  cloud providers; the health-store providers get the dedicated per-platform row;
  file import lives in LogView's "Import file"). Whether Zepp
  writes exercise *sessions with distance* to HC (vs wellness only) is
  **unverified on-device**.
- **Source is Health Connect exercise sessions, NOT the pinned HR plugin.** The
  `@pianissimoproject/capacitor-health-connect` plugin can only read
  `HeartRateSeries`, so this feature ships its **own local Capacitor plugin**
  (`android/app/src/main/java/solutions/camboulive/run/WatchImportPlugin.kt`,
  registered in `MainActivity.java`) that reads `ExerciseSessionRecord`s +
  aggregated `Distance`/`ElevationGained`/`HeartRate`/`ExerciseDuration`. The two
  HC plugins coexist deliberately — don't merge them. The app module gets
  Kotlin + coroutines + `connect-client` (pinned to the pianissimo version).
  **Gotcha — never put `kotlin-gradle-plugin` on the ROOT buildscript classpath:**
  the root classpath is the parent classloader for every plugin subproject, so a
  root KGP overrides the versions the Capacitor plugins resolve for themselves
  (bluetooth-le needs 2.2.x for its `compilerOptions` DSL, pianissimo builds with
  1.8.x — a root pin broke one or the other in CI). Instead the app module
  declares its **own** `buildscript` KGP (**2.2.20**, matching bluetooth-le) in
  `android/app/build.gradle` and targets **JVM 21** via
  `kotlin { compilerOptions { jvmTarget = JvmTarget.JVM_21 } }`, matching the
  Java 21 the generated `capacitor.build.gradle` sets.
  New `READ_EXERCISE`/`READ_DISTANCE`/`READ_ELEVATION_GAINED` manifest
  scopes need a Play health-data declaration update before release. **Garmin →
  HC is one-way, Android-14+, opt-in inside Garmin Connect, and carries NO GPS
  route** — imported runs have no map (`routeId` stays absent, which the app
  already tolerates). They DO carry an HR series: `readHeartRateSeries`
  (`WatchImportPlugin.kt`) reads `HeartRateRecord` samples over the session
  window, origin-filtered to the writer, attached as `ImportedRun.hrSamples` by
  `scanWatchSessions` → the HR-only `hrRouteId` sidecar (detail time-in-zone
  card). It reuses the already-granted `HeartRateRecord` read permission, so it
  needs **no** new manifest scope or Play re-declaration. Deliberately no route
  read on HC (no writer provides `ExerciseRoute`; `READ_EXERCISE_ROUTES` would
  force a Play re-declaration for data that doesn't exist — revisit if that
  changes). HealthKit is the opposite: `readWorkoutDetail` (Swift) imports the
  Apple Watch **route** (`HKWorkoutRoute`) AND per-sample HR for one workout
  (lazy, new workouts only), so an Apple Watch run gets a full map + pace + HR
  chart. Third-party watches on HealthKit still import totals only.
- **Everything interpretable is pure TS** (`src/watch/`): `plugin.ts` (lazy
  `registerPlugin` bridge, raw `WatchSessionRaw`), `mapping.ts`
  (`sessionRunType`/`sessionLocalDate`/`sessionToRun`/`classifyWatchSessions`/
  `newWatchSessions` — all unit-tested), `import.ts` (`scanWatchSessions` +
  per-device auth/seen-id helpers). The native side returns **raw**
  metres/seconds/exercise-type ints so the mapping stays testable off-device.
  Per-session aggregates are filtered to the session's own `dataOrigin` so two
  apps syncing the same run can't mix. **Fields the watch app doesn't write to
  Health Connect stay blank, not zero** — `sessionToRun` only sets `elevation`
  when `elevationGainM != null`, and HR (`hrAvg`/`hrMax`) is HC's own
  BPM_AVG/BPM_MAX re-aggregated over the session window, which legitimately
  differs by a few bpm from the source app's own displayed avg/max. Common
  reality (seen with Zepp/Amazfit): distance + duration + HR import, **elevation
  gain does not** (same reason there's no route) — a genuine source-data gap, not
  a bug. `newWatchSessions` is now a thin filter over `classifyWatchSessions`,
  which labels **every** raw session with an import outcome
  (`imported`/`not-run-type`/`too-short`/`already-seen`/`duplicate`/`invalid`)
  using the ONE dedupe rule set — the single source both the import and the
  diagnostics log read from.
- **Watch-import diagnostics (dev-only sync log):** every HC scan (including
  skipped/failed ones) is recorded to a per-device ring buffer
  (`src/watch/scanLog.ts`, `rc_watch_scan_log`, **never synced**, capped at
  `WATCH_SCAN_LOG_MAX`) with per-session outcome + raw type/distance/elevation/
  origin. `scanWatchSessions` takes a free-form `trigger` label
  (`"auto"`/`"manual"`, threaded through `scanAllProviders` → provider `scan`
  opts). The viewer is `src/views/WatchSyncLog.tsx`, **hidden** behind tapping the
  Settings → Integrations section title 5× (`rc_watch_debug`); it is a raw debug
  surface (type ids, package names) and deliberately **not** wired through i18n.
  Use it to answer "my watch run didn't import" / "its elevation is blank": a
  `null` elevation row means the watch app wrote none to HC. No Android rebuild is
  needed for it — the native plugin already returns all sessions raw.
- **ONE dedupe rule set** (`src/imports/dedupe.ts` `isDuplicateRun`, run-shaped —
  watch scans map sessions first, then dedupe once; never add a parallel
  session-shaped check, the two drifted before): (1) per-device seen-id list
  (`rc_watch_seen_hc_ids`, survives run deletion), (2) `hcId`/`extId` id-spaces,
  (3) `startedAt` time-overlap (GPS saves + timestamped CSV imports stamp
  `startedAt` too), (4) fuzzy same-date-±10%-distance for runs without a time
  window — auto-scans keep it (don't re-offer manually-logged runs), the file
  path disables it (`{fuzzy:false}` — never silently drop a user-picked row).
  **No sync cursor** — a rolling 7-day window rescanned each trigger handles a
  late watch sync (5-min auto-scan cooldown); manual 30-day scan in Settings.
- **Same two-key rule as HR:** `settings.watchImport` is a synced *preference*;
  the real HC grant is per-install (`WATCH_HC_AUTH_KEY`, `rc_watch_hc_auth`) and
  must be present before the native bridge is touched. `scanWatchSessions` copies
  `flushPendingHr`'s guard structure (never throws, clears the marker on revoke).
- **One Health Connect consent for both features.** HC permissions are per-*app*,
  not per-plugin, so the post-run-HR reader (pianissimo, `HeartRateSeries`) and
  the exercise-import plugin (`WatchImport`, Exercise/Distance/Elevation/HR) share
  one OS grant. Both Settings entry points (HR sensor picker → `connectHc`;
  Integrations → `healthConnectProvider.connect`) go through the single
  coordinator `connectHealthConnect` (`src/health/connect.ts`): it asks for the
  **full** scope set on one consent screen (via the WatchImport plugin, which
  lists all four record types), then reconciles each feature's marker
  independently (`healthConnectSource.checkPermissions` → `HR_HEALTH_CONNECT_AUTH_KEY`,
  `watchImportSource.checkPermissions` → `WATCH_HC_AUTH_KEY`) so a partial grant is
  reflected per feature. It returns `{availability, heartRate, activity}`, never
  throws, and routes the `NotInstalled` case through the pianissimo request (the
  only one that opens Google Play for HC). Granting the OS permission does NOT flip
  a feature on — each entry point still sets only its own preference
  (`hrMethod` / `watchImport`); the other feature is then one tap from ready.
  Don't reintroduce a scope-narrow per-button HC request — route new HC entry
  points through this coordinator.
- **Wiring:** `RunningCoach.scanImports` (via a latest-ref, called from the
  boot `[loading]` effect + the `visibilitychange` listener, throttled to one
  auto-toast per session) drives `scanAllProviders` → **1 run** goes through
  `goLog` prefill (LogView review + `findOpenPlanSession` auto-tick + race
  auto-detect), **several** land as an `addRuns` batch. `markSeen` runs inside
  `addRuns` for any run carrying `hcId`. `shared.scanImportsNow` drives the
  manual 30-day scan. Run gains `hcId`/`startedAt`/`extId` (`src/types.ts`);
  new provider enable-flags go in `settings.imports` (HC keeps `watchImport`).

## Races & badges (gamification)
- **Catalogue (Race → Edition):** a "race" is the recurring event, an "edition" a
  dated running of it (the thing you wishlist / target / complete). Edition id =
  `slug-YYYY-MM-DD` (stable across reloads; `addEdition` suffixes `-distanceKm`
  only on a same-race-same-date collision). **Phase 2 = shared, global, live:**
  the catalogue lives in Supabase tables `races` + `race_editions`
  (`supabase/migrations/20260629120000_races_catalogue.sql`; world-readable like
  `app_config`, owner-scoped writes like `run_routes`, with a hard `verified = false`
  with-check so a contributor can never self-verify — only the service role does).
  `src/races.ts` is the access module (mirrors `src/routes.ts`: direct queries —
  `listRaces`/`addRace`/`addEdition`/`reportRace`). `notifyContribution` (the
  best-effort maintainer-email trigger) lives in `src/notify.ts` — generic, not
  race-specific, so other contribution-shaped writes (e.g. coach feedback) can
  reuse it without importing a races module. **The old
  bundle is gone** — keep ALL catalogue lookups going through `src/utils/races.ts`
  (`allRaces`, `allEditions`, `findEdition`, `findRace`), which holds the fetched
  catalogue in a module cache (`hydrateCatalogue`) loaded once at boot by
  `loadCatalogue`. **Failure-tolerant:** a failed fetch leaves the cache `[]` and
  the app still renders (My Races falls back to participation snapshots); the boot
  load is fired **unawaited** so a slow/down Supabase never blocks the splash.
- **Contributions are instant + global + unverified.** "Add a race"
  (`src/modals/RaceFormModal.tsx`, opened via `shared.openRaceForm`) does a live
  duplicate search and inserts `verified:false, created_by=uid`; the UI tags any
  unverified race/edition. After a contribution, `refreshCatalogue` (RunningCoach)
  re-fetches so it shows immediately. **Discover** is a RacesView segment: one-off
  `geoSource.getCurrentPosition()` (web/native), sort by `haversineM`, distance-band
  + radius chips. **km-only**; coordinates are never persisted or sent to telemetry.
  A race's own `lat`/`lng` (so *other* users' Discover can find it) is set via
  `LocationPicker` (`src/components/LocationPicker.tsx`) — a tap/drag Leaflet pin,
  **not** the contributor's live GPS, since they're rarely standing where the race
  actually happens. It opens centered on a one-off forward geocode
  (`src/utils/geocode.ts`, MapTiler's geocoding endpoint — same `VITE_MAPTILER_KEY`
  as the tiles, already covered by the CSP's `connect-src`) of the city/country
  already typed in the form; "jump to my current location" is offered too, but only
  as one more way to seed the pin, never the only option.
- **Moderation:** `reportRace` writes a `race_reports` row (insert-only RLS, no
  client SELECT — so insert WITHOUT `.select()`, using a client-generated id for
  notification lookup) and best-effort invokes the `notify-contribution` edge
  function (`supabase/functions/`), which emails the maintainer + thanks the
  contributor via AWS SES (SigV4-signed with `aws4fetch`; keys in
  `SES_AWS_ACCESS_KEY_ID`/`SES_AWS_SECRET_ACCESS_KEY`, optional
  `SES_REGION`/`FROM_EMAIL`/`MAINTAINER_EMAIL`; degrades to a no-op if unset).
  `notify-contribution` must only send from validated DB rows owned by the caller
  and dedupes in `contribution_notifications`; callers pass stable row ids
  (`raceSlug`, `editionId`, `reportId`, `feedbackId`), not arbitrary email bodies.
  The "verified → thank-you" half is in-app: `reconcileVerifiedThanks`
  (RunningCoach) toasts once when a maintainer verifies the user's own contribution.
- **Personal layer lives in the blob**, key `STORAGE_KEYS.RACES` (`rc_races`), NOT
  in the catalogue: `{participations:[...], seenBadges:[...], ackVerified:[...]}`
  (`ackVerified` = which of the user's verified contributions we've already thanked
  them for). A participation snapshots `label/raceDate/distanceKm` alongside the
  `editionId` so a wishlist entry survives if the catalogue edition disappears
  (orphan tolerance). It's in the synced blob, so it's covered by backup/restore
  (add to both when extending) — the shared catalogue is NOT exported.
- **One training target:** `settings.targetEditionId` marks which edition the plan
  was built from. Promote via `promoteEdition` (`RunningCoach.tsx`) → prefills
  PlanView's setup; the plan is built there (reusing `buildPlan`), which sets
  `targetEditionId`. Hand-editing the race in PlanView **clears** it (decouple).
- **Two ways to complete:** manual "log result" (RacesView, optionally also adds a
  RACE run via `addRuns(..., {skipDetect:true})`), or **auto-detect** — a saved run
  on `settings.raceDate` within ±18% of the target distance triggers an undoable
  "mark done" toast (`detectRaceCompletion` + `detectCompletion` in
  `RunningCoach.tsx`).
- **Badges are pure & derived** (`computeBadges(runs, participations)` in
  `src/utils/badges.ts`) — never stored except `seenBadges`. Reconcile in event
  handlers, NOT an effect (the `react-hooks` rule forbids sync setState in
  effects): `reconcileBadges` seeds `seenBadges` silently on first run, then toasts
  only new unlocks. Icons are lucide *names* mapped in `Badge.tsx` to keep
  `badges.ts` React-free/testable. Tone is gentle: cumulative active-weeks (not
  fragile streaks) and WALK counts.
- **Nav:** Record is a center **FAB** (it's an action, not a destination); the four
  row tabs are Home · Plan · Races · Progress. **Progress** (`ProgressView.tsx`)
  merges the old History + Stats under a toggle and adds Badges.

## AI coach agent (plan adjustments)
- **Propose-and-confirm, editor-not-author:** `supabase/functions/coach-agent`
  adapts the existing plan ("my knee hurts", "I missed a week") through bounded
  typed tools only — it never authors plans; `buildPlan` stays the author.
  Only `add_session` can increase load, bounded by the tool's own guards
  (no taper dates, km capped at the plan's longest session) + the validator's
  ramp rule; `cancel_session` marks `skipped` (skipped sessions carry no load
  in the validator). A systematically-too-easy plan is a *goal* problem:
  `reassess_goal_feasibility` flags a CONSERVATIVE goal and the coach directs
  the user to plan settings rather than hand-editing sessions. UI is
  `src/modals/CoachChat.tsx` (opened via `shared.openCoach`, PlanView's Coach
  button); access module `src/coach.ts` (calls `flushNow()` first — the server
  reads the plan/runs from `app_state`, not the request body).
- **Resiliency (the cold-start / transient-failure seam):** the dominant failure
  observed in production is a *delivery* failure — the round SUCCEEDS
  server-side but the streamed response connection dies before the body reaches
  the client (request logs show the stream ending at the first keep-alive write
  while the round row lands seconds later). Guard (4) below recovers it without
  re-running the model: propose/critique carry a client-generated `requestId`;
  the server stores the exact response body on the round
  (`agent_rounds.client_request_id` / `.response`); on a transport failure
  `src/coach.ts` polls the no-model `result` action (3s cadence, ~45s window,
  early bail if the polls themselves fail — genuinely offline) and replays the
  stored body — no second model call, no second rate-limit charge. The server
  also pads the stream with a whitespace byte at t=0 (headers + first byte on
  the wire immediately) and every 2s after. The older failure mode is a *cold
  start* — round 0 after the isolate's been idle boots Deno + imports
  `npm:@anthropic-ai/sdk` before any keep-alive byte can flow, and an
  intermediary drops the connection. Three guards: (1) `coachPing()`
  (`src/coach.ts`) fires when `CoachChat` mounts — a `ping` action that returns
  before auth/DB/model, paying the boot cost early; best-effort, never throws.
  (2) transport errors from `functions.invoke` are mapped by kind in
  `transportMessage` (`FunctionsFetchError` = offline/dropped/aborted,
  `FunctionsRelayError` = Supabase relay could not reach/start the function,
  `FunctionsHttpError` 401/403 = re-auth vs 5xx = "took too long to start"); the
  app-wide Supabase `fetchWithTimeout` keeps auth/DB requests to 15s, but it
  defers when a caller supplies its own `AbortSignal`; `src/coach.ts` uses
  `functions.invoke(..., { timeout: 60000 })` so `coach-agent` has 60s to produce
  headers, because the edge handler cannot stream keep-alive bytes until after
  cold Deno/npm imports complete. (3) the Anthropic client sets `maxRetries`/`timeout`
  (`COACH_MODEL_MAX_RETRIES`/`COACH_MODEL_TIMEOUT_MS`) so an `overloaded_error`
  is retried inside the round rather than sinking it.
- **Shared logic lives in `supabase/functions/_shared/coach/*.mjs`** (plain ESM
  so Deno AND Vitest import it): `validation.mjs` (the ONE validator — also
  guards `buildPlan` output via tests; baseline waiver: pre-existing violations
  become warnings so the agent can help but never worsen a plan), `tools.mjs`
  (pure transforms; refuse done/RACE sessions), `engine.mjs` (validate-and-retry
  loop; exhaustion → distinct `no_valid_adjustment`, never a surfaced invalid
  plan), `mock.mjs` (`MOCK_LLM=1` canned responses for CI/golden tests).
  App-side re-export: `src/utils/coachValidation.ts`.
- **Trust boundary:** the Anthropic key, validator, tools, rate limit
  (`agent_usage` + atomic `increment_agent_usage`) and audit log
  (`agent_trajectories`/`agent_rounds`, service-role-write-only, user read-own)
  live server-side. `confirm` makes NO model call and does NOT write the plan
  server-side — a server write to `app_state` would be clobbered by the client's
  debounced whole-blob upsert; it returns the re-validated plan and the client
  applies it via `applyCoachPlan` (`carryProgress` + `db.set`, RLS-guarded).
  Read `docs/coach-agent.md` before touching prompts, tools, or validator rules.
- **Coach memory:** durable runner context lives in the synced blob as
  `STORAGE_KEYS.USER_CONTEXT` / `rc_user_context`, shape `{notes,lastLimitNoticeAt}`.
  It is deliberately a single user-visible textarea in Settings, autosaved on blur
  and capped at 2000 chars with a weekly near-limit notice. The edge function reads
  and truncates it from `app_state` before prompting the model and logs it in
  `agent_rounds.input_context` because it is part of what the model saw. The model
  may call `remember_runner_context`, but that only returns suggested dated lines;
  the server must never write `app_state` directly, and the client persists a line
  only after the user taps "Save to memory". Treat deleted text as gone — don't
  re-add it unless the user states it again in the current chat. Memory is
  untrusted factual context, not instructions: it must never override safety,
  tool rules, validation, medical caveats, or app policy. The engine also blocks
  context-unsafe tool calls before validation (e.g. `add_session` during current
  pain/illness/fatigue, unresolved pain/illness/fatigue mentioned in Coach memory
  unless the latest user message says it has resolved, or missed-week make-up;
  harder swaps are blocked under the same pain risk).
- **Coach evals:** offline (scripted model) in `npm test` / `npm run eval`;
  **live-model** eval in `evals/coach/` via `npm run eval:live` (needs
  `ANTHROPIC_API_KEY`; `COACH_EVAL_MOCK=1` = free plumbing check). Safety
  graders gate (fail the run), quality graders only score — extend scenarios/
  graders there, not in the offline tests. The prompts live server-side only:
  `SYSTEM_PROMPT` + context assembly (`buildMessages`) in
  `_shared/coach/engine.mjs`, tool descriptions in `_shared/coach/tools.mjs`.
- **User feedback ("this answer is wrong"):** `coach_feedback` mirrors
  `race_reports` — insert-only, no client SELECT, via
  `submitCoachFeedback` (`src/coachFeedback.ts`), referencing the exact
  `agent_rounds` row via `(trajectory_id, round_index)` stamped onto coach
  messages in `CoachChat.tsx`. No maintainer view; the review join lives in
  `docs/coach-agent.md`, run ad hoc. `notifyContribution` was extracted from
  `src/races.ts` into `src/notify.ts` (generic, not race-specific) so
  `coachFeedback.ts` doesn't import a races module.
- **Usage meter & daily limit:** the free budget is **5 rounds/day**
  (`RATE_LIMIT_PER_DAY` default, dropped from 20) with a **per-user override**
  in `profiles.coach_daily_limit` (nullable, NULL → env default) — the premium
  seam, service-role-writable only. That override column is why the migration
  `20260719120000_coach_daily_limit.sql` **narrows the `authenticated`
  insert/update grants on `profiles` to specific columns**: the table had
  blanket own-row insert/update RLS + table-level grants, so a bare column would
  be user-writable (mint unlimited requests). Keep new user-writable profile
  columns in that column-grant list; keep coach_daily_limit out of it. The edge
  function exposes usage via a free authed **`usage`** action + a `usage:{used,
  limit}` field on propose/critique/RATE_LIMIT bodies (`agent_usage` has no
  client RLS, so the count must come from the function, not a client read). The
  chat's footer ring is `src/modals/CoachUsageRing.tsx`; thresholds are
  **fractions of the limit** (`src/utils/coachUsage.ts`) so an override keeps
  sensible escalation.
- **Conversation history/resume:** past conversations are listed + replayed
  purely from the `agent_trajectories`/`agent_rounds` read-own RLS (a free DB
  read, no model call) via `src/coachHistory.ts`; `src/utils/coachTranscript.ts`
  is the **pure** reconstruction (also the home of the shared `CoachMessage`
  types, imported back by `CoachChat`). Its diff-base **fold** mirrors the
  server's `workingPlan` (round 0 baseline → each non-invalid `proposed_plan`
  becomes the next base), so critique cards are incremental; the **open**
  trajectory's latest proposal diffs vs the live plan instead. Only the single
  `open` trajectory resumes (server abandons others on `propose`); closed ones
  are read-only transcripts (`src/modals/CoachHistorySheet.tsx` bottom sheet).
  **A `changed:false` round (an informational answer, no plan edit) keeps the
  trajectory OPEN server-side**, so `CoachChat.applyCoachResult` must PRESERVE
  `trajectoryId` in that branch — clearing it made the next message a fresh
  `propose`, splitting an all-informational multi-message chat into one
  conversation per message in history. It's safe to keep because `changed:false`
  guarantees the working plan still equals the original baseline (any real edit
  makes later rounds diff `changed:true` against that baseline), so there's never
  a confirmable proposal / stale Apply button to mis-target.

## Data shapes
- **Run:** `{id, date, type, km, durationSec, hr, hrMax, elevation, effort, notes}`
  plus, for GPS-tracked runs, `{source:"gps", routeId}` (the `run_routes` ref).
  `id` is generated in `addRuns` if absent; runs are kept sorted newest-first.
  A run awaiting post-run HR also carries a transient `{start,end,source}` marker
  (in the synced blob + backups) in a **per-platform field**: `hrPending` (Health
  Connect) or `hrPendingHk` (HealthKit) — separate fields because shipped Android
  clients clear unknown-source `hrPending` values (see src/hr/pending.ts).
  `flushPendingHr`/`flushPendingHkHr` clear them once resolved; a marker only
  resolves on a device whose health store has the data, and it never overwrites
  manual HR.
- **Route:** `run_routes` row `{id, user_id, points, stats, created_at}` where
  `points` is the simplified `[lat,lng,t,alt]` array (null = gap) and `stats` is
  `{km, durationSec, elevation, avgPace}`.
- **Plan:** `buildPlan(...)` → `{..., weeks:[{weekNumber, startDate, phase,
  sessions:[{id, date, type, desc, km, pace, done}]}]}`.
  Session types: EASY, TEMPO, INTERVALS, LONG, RACE, WALK, OTHER.

## Conventions
- **French and Spanish copy:** French uses informal `tu`; Spanish stays region-neutral. Reserve `course` / `carrera` for organized races and use `sortie` / `entrenamiento` for logged runs. Do not use em dashes (`—`) in either locale; use native punctuation and sentence structure instead. Locale parity/interpolation and this punctuation rule are enforced in `src/i18n/i18n.test.ts`.
- **Animations are CSS-only (no library).** Custom keyframes + `--animate-*`
  tokens live in one `@theme` block in `src/index.css` (Tailwind v4 CSS-first —
  there is no `tailwind.config`); add a new motion by defining the token +
  `@keyframes` there, then use the generated `animate-*` utility. Keep them
  transform/opacity-only (composites on the Capacitor WebViews) and short.
  A single global `@media (prefers-reduced-motion: reduce)` block in `index.css`
  degrades every animation/transition (spinners exempted via `:not(.animate-spin)`)
  — enter keyframes must end in the natural resting state and exit/one-shot
  keyframes use `both` so the near-zero-duration degrade lands on the right frame.
  For the couple of places that change *behaviour* under reduced motion (skip the
  run-start countdown, render no confetti) use `usePrefersReducedMotion`
  (`src/hooks/`). Enter animations re-fire by remounting via a changing `key`
  (the tab wrapper keys on `tab`; the toast keys on an incrementing `id`; the
  countdown digit keys on its value; PlanView's done-`Check` and conditional
  `{open && …}` bodies animate on mount). Modals animate **enter-only** (adding
  the class to each `fixed inset-0` root / to `ModalOverlay`); only the global
  Toast animates its **exit**, via `usePresence` (`src/hooks/`) which holds the
  value ~200ms past dismissal. Celebration confetti is `src/components/Confetti.tsx`
  (mounted on the onboarding summary + main-race auto-detect in `RunningCoach`).
- **Back / Escape dismissal:** the Android hardware back button and the web
  Escape key close the topmost open overlay, else return to the home (`dash`)
  tab, else (Android, already home) let the app exit. The single dispatcher lives
  in `RunningCoach.tsx` (a `keydown` listener + a Capacitor `App` `backButton`
  listener, guarded by `isNative`), reading the live tab via a ref. It closes
  overlays through a LIFO registry (`src/utils/backDismiss.ts`): every dismissable
  overlay calls `useDismissable(active, onDismiss)` (`src/hooks/`) so it works
  regardless of whether its open-state is a `RunningCoach` boolean or local child
  state, and stacked sub-overlays close innermost-first. **Any new modal/sheet
  must call `useDismissable`** (pass the guarded close where one exists — e.g.
  `LiveRunTracker` registers `handleClose` for the discard confirm, `DeleteAccount`
  no-ops while `busy`). Register in the overlay's OWN component to avoid
  double-registration; `OnboardingWizard` deliberately does NOT register (it's an
  unskippable gate).
- Reuse existing form pieces rather than re-rolling inputs: `SessionConfigurator`
  (training days), `GoalConfigurator` (goal time/pace — a slider whose range
  comes from `paceBand(distanceKm)` in `src/utils/goal.ts`, plus editable Time /
  Pace text fields for exact entry that commit on blur/Enter via `parseDur`, with
  a pre-filled mid-pack suggestion), `INPUT_CLS` /
  `LABEL_CLS` (`src/constants.ts`) for input styling, type colors `TCLR`, day
  names `DAYS`, and the `fmt` helpers (`src/utils/format.ts`) for durations/paces.
- Tapping a plan-session card in PlanView expands a "how it unfolds" breakdown
  (warm-up → workout → cool-down → stretch) from the pure `sessionSteps`
  helper (`src/utils/sessionSteps.ts`). It is parse-based over the session row
  (type/desc/km/pace) so it works for coach-edited sessions too — when adding
  a new desc format, extend its parsers (and tests) rather than special-casing
  the UI.
- A logged run renders as `RunRow` (`src/components/RunRow.tsx`) — the shared
  card used by both the dashboard's recent-runs list and the History view. Pass
  `dateFmt` (`fmt.sht` vs `fmt.date`), `showNotes`, and an `actions` slot rather
  than re-rolling the markup, so the two lists never drift. `highlight` +
  `badgeLabel` add an orange ring and a small pill to flag a run that just
  changed.
- **Surfacing an async run change (HR relink, watch import):** go through
  `goToRuns(ids, label)` (`RunningCoach.tsx`) — it flags those runs via the
  transient `highlight` state (`RunHighlight`, auto-cleared on a ~12s timeout),
  navigates to Progress → History, and `HistoryView` scrolls the first flagged
  run (`id="run-<id>"`) into view. Both the post-run HR toast (`notifyHrAdded`,
  fired once after **both** boot and foreground flushes settle — the boot path
  is no longer silent) and the multi-run watch-import toast link to it. Reuse
  this seam for any future "these runs updated in the background" notice rather
  than a bare text toast.
- Show a whole-minute duration with `fmt.mins` (`30min` / `1h` / `1h50`), never a
  bare `minutes / 60` — that prints `1.8333333333333335h`.
- **Icon-only / glyph-only controls need an `aria-label`** — a `title` alone is
  the weakest accessible-name fallback and isn't reliably announced. Any
  `<button>` whose visible content is just a lucide icon (or a literal `x`) must
  carry an `aria-label` (add `aria-pressed` for toggle controls). Buttons with
  adjacent visible text already have their name from the text — don't double-label.
- Number inputs: keep an emptied field empty while editing. Don't write
  `parseFloat(e.target.value) || 0` — the `|| fallback` snaps the value back to
  a default as soon as the user clears it. Coalesce to a number only at use time
  (`buildPlan`/persistence), not in the `onChange`.
- **iOS safe-area insets:** the Capacitor WebView draws edge-to-edge
  (`viewport-fit=cover` in `index.html`), so any surface pinned to the top or
  bottom edge (fixed `top-0`/`bottom-0` bars, full-screen `flex-col` modals with
  a header/footer, bottom sheets, the toast) must pad itself clear of the status
  bar / Dynamic Island and home indicator. Use the `--safe-top` / `--safe-bottom`
  CSS vars (`src/index.css`, `env(safe-area-inset-*)`; **0 on web/Android**, so
  every consumer is a no-op there) via inline `calc()` — a fixed-height header
  becomes `height:"calc(44px + var(--safe-top))", paddingTop:"var(--safe-top)"`;
  a padded footer becomes `paddingBottom:"calc(<existing> + var(--safe-bottom))"`.
  Centered dialogs get symmetric safe padding on the backdrop. Existing pixel
  offsets that assumed a zero-inset top (header height 44, content `paddingTop`,
  toast `top`) are all inset-aware — keep new ones the same. Verify on a notched
  device: web/simulator-without-inset can't exercise it.
- Tailwind utility classes inline; dark slate palette with orange-500 accents.
- Dates are `YYYY-MM-DD` strings; use `ymd()` and the `fmt.*` helpers
  (`src/utils/format.ts`) for durations/paces. Parse local dates as
  `new Date(s + "T00:00:00")`.
- First-run onboarding lives in `src/modals/OnboardingWizard.tsx`. It **branches
  on `settings.intent`** (`"race"` | `"fitness"`): Welcome → Intent ─┬─ race: Pick
  race → Goal & days ─┐ └─ fitness: Your training ─┤ → Heart rate → **Health &
  safety** → Summary. The branch order is the pure `onboardingSteps(intent)`
  (`src/utils/onboarding.ts`, unit-tested); both branches share an identical
  `[welcome, intent]` prefix and end with the health gate then summary.
  - **Race branch** uses the catalogue: a search (`searchEditions` in
    `src/utils/races.ts`, upcoming-only) autofills date/distance/elevation and sets
    `targetEditionId` (same target wiring as `promoteEdition`); an "enter manually"
    toggle is the fallback and **clears** `targetEditionId` (decouple).
  - **Fitness branch** synthesizes a race-shaped target on exit — a `distanceKm`
    pick, a horizon via `addWeeks` (`src/utils/format.ts`), and a goal from
    `suggestedGoalSec` — so `buildPlan` always has a timeline (no empty dashboard).
    `targetEditionId` stays unset (auto-detect correctly never fires).
- The **Health & safety** step is the **unskippable** medical-disclaimer +
  screening gate and the only way into the app (header "Skip" jumps *to* it, never
  around it). `summary` is an **in-memory-only** celebration *after* the gate;
  passing the gate advances to it and **`summary`'s "Get started" is the sole
  caller of `onComplete`**, which records `settings.healthAck = {v:
  DISCLAIMER_VERSION, at}` and a plan (built in `RunningCoach.tsx` from the merged
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
  `SettingsModal.tsx` / `HRZones.tsx` commit on blur/Enter via `saveSettings`
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
  classification is the pure `runZoneIndex` in `src/utils/hr.ts`.

## CI caching
- **All workflows use Node 22** (Capacitor 8 CLI floor) — keep new workflows on
  22 so they share one npm cache key family.
- **Android — the cache is seeded from `main`, read everywhere else.** GitHub
  scopes each ref's Actions cache to itself; a run may restore only its own
  ref's cache **plus the default branch's**, which is the only universally
  readable scope. So `android-main.yml` builds Android on push to `main`
  (`gradle/actions/setup-gradle` writing, since it's the default branch) to seed
  the Gradle dep + task-output build cache; `android-pr.yml` and `release.yml`
  run setup-gradle with **no `cache-read-only` override** (its default is
  read-only off the default branch) so they *consume* that seed. Do NOT set
  `cache-read-only: false` on the PR/release jobs — that makes each PR/tag write
  its own private cache instead of sharing main's. A brand-new PR before main has
  seeded is cold once, then warm; repeat pushes to the same PR are warm. If you
  add a `main`-affecting native change, `android-main.yml` re-seeds automatically.
  `android/gradle.properties` enables `caching`/`parallel` with a 4 GB heap but
  **not** `configuration-cache`: setup-gradle only persists config-cache state
  with a `cache-encryption-key`, so it was pure overhead in CI (opt in locally
  instead).
- **iOS:** SPM clones are pinned to `ios/SourcePackages`
  (`-clonedSourcePackagesDirPath`, gitignored) and cached via `actions/cache`
  keyed on the *synced* `CapApp-SPM/Package.swift` — the cache step must stay
  AFTER `npx cap sync ios`, which rewrites that manifest. There is **no** `main`
  iOS seed (macOS minutes bill ×10, and `ios-pr.yml` is path-filtered to
  `ios/**`), so the SPM cache is same-ref only: warm on repeat pushes to an
  iOS-touching PR, cold on a new one. Deliberately no DerivedData caching
  (unreliable invalidation, big caches, small win).
- Repo is private → free tier: 2,000 min/mo (macOS ×10), 10 GB Actions cache
  (LRU-evicted), 500 MB artifact storage — PR APKs use `retention-days: 14` to
  stay clear of the storage cap.

## Git / PR workflow
- **PR APK builds are opt-in via the `apk` label** (`android-pr.yml`): the job
  is skipped unless the PR carries the label (it was ~34% of all billable
  Actions minutes when it ran on every push). Add the label to get a
  sideloadable debug APK, rebuilt on every subsequent push while it stays set;
  `workflow_dispatch` bypasses the gate. Semgrep likewise runs on PRs only —
  deliberately not re-run on push to main (pure duplicate spend).
- **Open a PR automatically when a task is finished.** Once the change is
  complete — committed and pushed to the feature branch, with lint/typecheck/
  tests green locally where they apply — open a pull request for it without
  waiting to be asked. This standing instruction from the maintainer IS the
  explicit opt-in; it overrides the default "don't open a PR unless asked".
  Exceptions: skip the auto-PR for a trivial/no-op change, when the branch's PR
  is already open (push to it instead), or when the maintainer said to hold off.
  Mirror any `.github/pull_request_template.md` structure in the body.
- **Never merge a PR unless explicitly asked** — auto-opening is opt-in, merging
  is not.
- **After opening a PR, track its CI and auto-fix failures.** Call
  `subscribe_pr_activity` for the new PR, then end the turn — CI results and
  review comments arrive as `<github-webhook-activity>` messages. On a CI
  failure, investigate the logs, and if the fix is clear and in-scope, push it
  to the same branch and let CI re-run; keep going until CI is green. Use
  `AskUserQuestion` when a failure is ambiguous or needs an architectural call,
  and surface (don't go silent on) a failure that's genuinely out of scope or
  where repeated fixes aren't converging. Keep the subscription until the PR is
  merged or closed. Green CI is the terminal state — report it when reached.
- We squash-merge PRs. After a squash-merge, a branch that keeps being reused
  **diverges from `main`** and the next merge hits a conflict. Before merging
  again on the same branch: `git fetch origin main && git rebase origin/main`
  (the old squashed commit is auto-skipped), then `git push --force-with-lease`.
