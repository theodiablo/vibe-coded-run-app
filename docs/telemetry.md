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

## Consent model

- **Opt-out.** On by default, with a toggle in **Settings → Privacy** the user
  can flip off and on at any time. The choice is stored in
  `settings.analyticsEnabled` (synced to Supabase like the rest of settings) and
  mirrored to `localStorage` (`rc_telemetry_consent`) so it's known
  synchronously at boot, before the app_state blob loads.
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
- `identifyUser` / `resetUser` on auth — `src/App.jsx`.
- Consent mirror + events (`onboarding_completed`, `run_logged`,
  `plan_generated`) — `src/RunningCoach.jsx`.
- Settings toggle — `src/modals/SettingsModal.jsx`.

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
