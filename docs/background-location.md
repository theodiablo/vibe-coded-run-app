# Background location (Android)

Live run tracking needs GPS fixes to keep coming when the phone screen is off. The
foreground-service-only model (under the "while using the app" grant) left
minutes-long GPS holes on some devices once the WebView froze, so the app declares
and requests **`ACCESS_BACKGROUND_LOCATION`** ("Allow all the time") for all users.

## How it works in the app

- **Declared** in `android/app/src/main/AndroidManifest.xml` (alongside
  `ACCESS_FINE`/`COARSE_LOCATION`, `FOREGROUND_SERVICE_LOCATION`,
  `POST_NOTIFICATIONS`).
- **Requested in-context, never at launch.** When the user opens the run tracker
  and accepts the prominent `BgLocationDisclosure`, the app requests, in order:
  1. Foreground fine location (`ensureForegroundPermission`, precise).
  2. Background location (`ensureBackgroundLocationOnce` → `RunPermissions.requestBackgroundLocation`).
     On Android 11+ this routes to a Settings screen ("Allow all the time").
  3. `POST_NOTIFICATIONS` for the recording notification.
- **Asked once per install** (`BG_LOC_ASKED_KEY`); a denial never re-nags and
  **never blocks recording** — a run still records while the screen is on.
- The disclosure shows an explicit, bolded step-by-step walkthrough of those three
  prompts (`login.bgLocation.step1/2/3`), gated on `isBackgroundLocationAvailable()`
  so it only appears where the permission exists (Android, not web/iOS).
- The native `RunPermissions.checkBackgroundLocation` still reports `declared` and
  the request no-ops if the permission is ever absent from a build — defensive, so
  the path can't crash.

## Google Play requirements — DO THIS before the next release

Shipping `ACCESS_BACKGROUND_LOCATION` triggers Google Play's background-location
review. The release will be **rejected** if these are not completed:

- [ ] **Permissions declaration** (Play Console → App content → *Sensitive app
      permissions* → Location): declare background access, describe the core feature
      (screen-off run tracking), and confirm the in-app prominent disclosure.
- [ ] **Demo video**: a link showing the prominent disclosure, the permission
      request, and the feature using background location. Required for approval.
- [ ] **Foreground service declaration** (App content → *Foreground service
      permissions*): the `location` FGS type is already declared in the manifest;
      justify it in the console.
- [ ] **Data safety form**: declare Location (precise) collection, purpose (app
      functionality), whether shared (no), and that it's not sold.
- [ ] **Privacy policy** (`PRIVACY_URL`) must explicitly cover background location:
      what's collected, when (only during a recorded run), and how it's stored.
- [ ] Budget for review friction — background-location apps are frequently bounced;
      the feature must read as essential.

## Reverting / scoping down

If Play review is a problem, the safe fallback is to move the permission back to a
**debug-only manifest overlay** (`android/app/src/debug/AndroidManifest.xml`, a
single `<uses-permission>`): the manifest merger applies `src/debug/` to the debug
variant only, so it reaches sideload/CI-`apk` builds but never the release AAB, and
`isBackgroundLocationDeclared()` makes the whole request a no-op where it's absent.
That was the original personal-build-only approach (PR #115).

## iOS

iOS is unaffected by this change — there is no `ACCESS_BACKGROUND_LOCATION`
equivalent. Background tracking uses the `location` background mode in
`ios/App/App/Info.plist` (already present); `isBackgroundLocationAvailable()` is
false on iOS, so the Android-specific "Allow all the time" copy never shows there.
