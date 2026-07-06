# Telemetry (analytics + crash reporting)

Telemetry is **vendor-agnostic at the call sites and off by the time it reaches
the network**. The app only ever talks to one seam, `src/telemetry/index.js`;
the vendor lives behind it in a single adapter (`src/telemetry/posthog.js`, the
only file that imports an SDK). Swapping vendors means replacing that adapter and
nothing else.

The provider is **PostHog** (product analytics *and* error tracking in one SDK).
It is **off until keyed**: without `VITE_POSTHOG_KEY` the adapter reports itself
unconfigured and the whole module is a no-op — and `posthog-js` is a dynamic
import, so it isn't even fetched until telemetry activates at runtime (it stays
out of the main bundle and out of any keyless build).

## Configuration

Set at build time (e.g. `.env.local`), same pattern as `VITE_MAPTILER_KEY`:

| Env var              | Required | Default                       | Notes |
| -------------------- | -------- | ----------------------------- | ----- |
| `VITE_POSTHOG_KEY`   | yes      | — (telemetry off without it)  | PostHog **project API key** (public, client-side). |
| `VITE_POSTHOG_HOST`  | no       | `https://eu.i.posthog.com`    | EU Cloud by default (privacy hosting). Use `https://us.i.posthog.com` or a self-host URL to change region. |
| `VITE_APP_ENV`       | no       | `development`                 | Tags every event + crash with an `environment` super property. The deploy workflows set `production`; the PR-preview workflows set `preview`; unset (local builds) is `development`. |

The PostHog SDK is initialised with autocapture, pageviews, pageleave and
session recording all **off** (this is a no-router SPA — we send a small curated
set of explicit events) and `person_profiles: 'identified_only'`.

Every event (and every crash) carries two super properties: `environment`
(above) and `native` (true in the Capacitor shell). **PR previews send to the
same PostHog project as production** — filter on `environment = 'production'` in
your insights to exclude preview/local noise. Vite's own `MODE` can't tell
production from preview (both are a `vite build`), which is why `VITE_APP_ENV` is
an explicit var.

**Two gotchas if events don't arrive:**

- **CSP.** PostHog's host is allow-listed in `connect-src` in `index.html`
  (`https://*.i.posthog.com`, covering EU + US). Without it the browser / Android
  WebView silently blocks every request and you'll see nothing. We also set
  `disable_external_dependency_loading: true` so PostHog never injects remote
  `<script>`s, keeping `script-src 'self'`. If you point `VITE_POSTHOG_HOST` at a
  self-hosted/custom domain, add it to `connect-src` too.
- **Region must match the key.** The default host is **EU** (`eu.i.posthog.com`).
  A **US** project's key only works against `https://us.i.posthog.com` — set
  `VITE_POSTHOG_HOST` accordingly. The `*.i.posthog.com` CSP already allows both.

## Consent model

- **Opt-in (EU/ePrivacy).** Telemetry collects **nothing** until the user accepts
  via the first-run **`ConsentBanner`** (`src/components/ConsentBanner.jsx`),
  shown over both the login screen and the app. Until then the SDK never inits,
  so no cookie / `localStorage` entry is written on the user's behalf. The choice
  is changeable any time in **Settings → Privacy**.
- **Consent is per-device.** The single source of truth is `localStorage`
  (`rc_telemetry_consent_v2` — rotated from `rc_telemetry_consent`, which the old
  opt-out build auto-populated), tri-state: `"1"` granted, `"0"` denied, **absent =
  undecided** (banner not answered → reads as not consented). It is deliberately
  *not* in the synced app_state blob: consent to store data on a device is
  inherently per-device, so a fresh browser should ask again. `getConsent()`
  returns true only for `"1"`; `getConsentDecision()` exposes the tri-state for
  the banner's visibility.
- **Native crashes get a second gate.** Even with analytics consent on, a native
  crash is held by the `ErrorBoundary` and uploaded only after the user taps
  **Send report** on the crash screen. Nothing leaves the device on a per-crash
  basis without that in-the-moment OK.
- `track()` / `identifyUser()` are gated on consent. `captureError()` is not —
  its call sites are (web boundary/global handlers check consent; the native
  crash screen calls it only on "Send"). Keep that split when extending.

## What's wired today

- `initTelemetry()` / `installGlobalErrorHandlers()` — `src/main.jsx`.
- `ErrorBoundary` around `<App/>` — `src/main.jsx` / `src/components/ErrorBoundary.jsx`.
- First-run opt-in `ConsentBanner` + `identifyUser` / `resetUser` on auth —
  `src/App.jsx`.
- Events (`onboarding_completed`, `run_logged`, `plan_generated`,
  `race_target_set`, `race_completed` `{source:"manual"|"auto"}`,
  `plan_race_added` — a secondary race folded into the plan) —
  `src/RunningCoach.jsx`. Pseudonymous: counts/enums only, never race
  names/notes/times. `plan_race_added` carries no properties (there is no race
  priority/tier).
- Coach agent events: `coach_proposal` `{status:"proposed"|"no_valid_adjustment",
  round}` when a proposal round returns, `coach_plan_applied` when the user
  accepts one — `src/modals/CoachChat.jsx`. Pseudonymous: never the message text,
  the plan, or the tool calls (those live server-side in `agent_rounds`).
- Catalogue events (Phase 2): `race_contributed` `{kind:"race"|"edition"}` when a
  user adds to the shared catalogue (`src/modals/RaceFormModal.jsx`); `find_near_me`
  `{}` the first time the "Near me" toggle is enabled in Races → Find a race
  (`src/views/RacesView.jsx`). Both pseudonymous — enum/no-args only, **never** race
  names, free text, or the user's location/coordinates.
- Settings → Privacy toggle (reads/writes consent directly) —
  `src/modals/SettingsModal.jsx`.

## How the PostHog adapter maps to the seam

`src/telemetry/posthog.js` implements:

```js
isConfigured(): boolean              // !!VITE_POSTHOG_KEY
init(): void                         // load SDK (dynamic import) + opt_in_capturing
shutdown(): void                     // opt_out_capturing
identify(id): void                   // posthog.identify(supabaseUserId)
reset(): void                        // posthog.reset()
track(event, props): void            // posthog.capture(event, { ...props, native })
captureError(error, context): void   // posthog.captureException; context: { kind, componentStack }
```

Consent is driven entirely from `opt_in_capturing` / `opt_out_capturing` (the
SDK loads in `opt_out_capturing_by_default` mode), so a single import serves both
states. `init`/`track`/`identify` run through a tiny queue that replays calls
made before the dynamic import resolves.

The opted-out **native per-crash** path (`captureError` while opted out) opts in
just long enough to send the one exception and does **not** synchronously
re-opt-out — that would risk dropping the still-queued report. It's safe because
the app is on the crash screen (no other events firing) and the next reload
re-reads the persisted opt-out and starts paused again.

## Swapping vendors

Replace `const provider = posthogProvider;` in `src/telemetry/index.js` with
another adapter implementing the interface above; keep the SDK import confined to
that one adapter file, read keys from `import.meta.env.VITE_*` (no baked-in
default, like `MAP_KEY`), gate any native-only SDK pieces on `isNative`, and
prefer the vendor's EU/privacy host. For example **Sentry** (`@sentry/react` +
`@sentry/capacitor`) would wire its `beforeSend` to drop events when
`getConsent()` is false, so even native background errors honour consent.
