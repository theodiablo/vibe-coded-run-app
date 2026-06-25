# Telemetry (analytics + crash reporting)

Telemetry is **vendor-agnostic and off by the time it reaches the network**: a
single seam, `src/telemetry.js`, is all the app talks to. Until a provider is
wired in there, every call is a no-op — nothing is sent, no SDK is bundled.
This is intentional. The consent machinery shipped first; the vendor is a later,
isolated change.

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

## Adding a provider

Implement the adapter interface and replace `const provider = noopProvider;` in
`src/telemetry.js`. Keep the SDK import confined to that file.

```js
isConfigured(): boolean              // key present in env, safe to init
init(): void                         // start the SDK (once consent is given)
shutdown(): void                     // stop/flush the SDK (on opt-out)
identify(id): void
reset(): void
track(event, props): void
captureError(error, context): void   // context may carry { kind, componentStack }
```

Notes for whichever vendor is chosen:

- **One bundle serves web and the Capacitor shell.** Gate native-only SDK pieces
  on `isNative` (`src/native.js`); the web build must stay unchanged when no key
  is set. Read keys from `import.meta.env.VITE_*` with no baked-in default, the
  same way `MAP_KEY` does — `isConfigured()` returns false without the env var.
- **EU / privacy hosting.** Prefer the provider's EU region/host where offered
  (matches the "opt-out + privacy hosting" decision).
- **Sentry** (crash-first): `@sentry/react` for web + `@sentry/capacitor` for
  native crashes/source maps. Wire its `beforeSend` to drop the event when
  `getConsent()` is false, so even native background errors honour consent.
- **PostHog** (analytics-first, also error tracking): `posthog-js`; call
  `posthog.opt_out_capturing()` / `opt_in_capturing()` from `shutdown()` /
  `init()` to match consent.
