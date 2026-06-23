# Running Coach 🏃

> A free, open-source training app I built because I got tired of being nagged to upgrade.

**[→ Try it live at run.camboulive.solutions](https://run.camboulive.solutions)**

---

## Why this exists

I recently got into running and started preparing for a race. I just wanted a simple app to:

- Build a training plan around my race date and goal time
- Log my runs and track my progress
- Not get pestered about going Premium every five minutes

Spoiler: every app I tried failed the last point. Strava, I'm looking at you.

So I did what any reasonable person would do — I spent a weekend vibe-coding my own.

If you're in the same boat, **[sign up and give it a go](https://run.camboulive.solutions)** — it's free, no premium tier, no upsells. Ever.

You can also fork it, run your own copy, or suggest features. All feedback is welcome!

---

## Design philosophy: boring is good

The app is intentionally **100% static and serverless**:

- The entire thing is a React SPA that compiles to a handful of static files, deployed on S3 + CloudFront.
- Auth and per-user data (runs, plan, settings) are handled by [Supabase](https://supabase.com) — no custom backend, no server to patch.
- This keeps the attack surface tiny, the maintenance burden near zero, and the hosting cost close to nothing.

---

## Tech stack

- **React 19 + Vite** — the SPA itself
- **Tailwind CSS** — styling
- **Supabase** — auth + a single JSONB row per user for all app state
- **S3 + CloudFront** — hosting, deployed via GitHub Actions on every push to `main`

---

## Running your own copy

Want to fork this and make it yours? Here's everything you need.

### Prerequisites

- **Node 20+**
- A free **[Supabase](https://supabase.com)** account (the free tier is plenty)

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a new project, then grab your
**Project URL** and **anon (public) key** from *Settings → API*.

### 2. Set up the database schema

In your Supabase project, open the **SQL Editor** and run the migration files
in order from `supabase/migrations/`:

1. `20260607114706_init_schema.sql`
2. `20260607165159_grant_table_privileges.sql`
3. `20260614120000_harden_security_definer_functions.sql`
4. `20260620120000_run_routes.sql` — GPS route traces
5. `20260623120000_app_config.sql` — app version gate (in-app update prompt)

Alternatively, if you have the [Supabase CLI](https://supabase.com/docs/guides/cli)
and Docker installed, you can run a full local stack:

```sh
supabase start        # spins up a local Postgres + Auth + Studio
supabase db push      # applies migrations
```

### 3. Point the app at your Supabase project

Open `src/config.js` and replace the two default values with your project's
URL and anon key (both found under *Settings → API* in the Supabase dashboard):

```js
export const SUPABASE_URL = "https://your-project-id.supabase.co";
export const SUPABASE_ANON_KEY = "your-anon-key-here";
```

Alternatively, you can set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as
environment variables at build time — they take precedence over the values in `config.js`.

### 4. Run it

```sh
npm install
npm run dev
```

That's it — the app is fully self-contained once it talks to your own Supabase project.

### 5. Deploy (optional)

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds the app and
syncs `dist/` to an S3 bucket behind a CloudFront distribution. Set these
**repository secrets** in your fork (*Settings → Secrets and variables → Actions*):

| Secret | Value |
|--------|-------|
| `AWS_REGION` | e.g. `eu-west-3` |
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN assumable via OIDC from GitHub Actions |
| `S3_BUCKET_NAME` | target S3 bucket (serve as a static website or via CloudFront) |
| `CLOUDFRONT_DISTRIBUTION_ID` | distribution to invalidate after each deploy |
| `VITE_MAPTILER_KEY` | *(optional)* MapTiler key for the map basemap on GPS-tracked runs — see [Maps](#maps). Omit it and the app still records runs, just without tiles. |

The workflow uses GitHub's OIDC provider to assume the IAM role — no long-lived
AWS credentials stored in GitHub. The role needs S3 write access and these
CloudFront permissions: `CreateInvalidation`, `ListResponseHeadersPolicies`,
`CreateResponseHeadersPolicy`, `GetResponseHeadersPolicy`,
`UpdateResponseHeadersPolicy`, `GetDistributionConfig`, `UpdateDistribution`.

---

## Local development commands

```sh
npm install           # install dependencies (run first after cloning)
npm run dev           # start the Vite dev server
npm test              # run the Vitest suite once
npm run test:watch    # watch mode
npm run lint          # ESLint
npm run build         # production build → dist/
npm run preview       # preview the production build locally
```

---

## Android app (background GPS tracking)

The web app records runs only while the screen is on — browsers can't track in the
background. The **Android app** wraps the same web build in a [Capacitor](https://capacitorjs.com)
shell and swaps the GPS source for a native background-location plugin, so a run
keeps recording with the screen off or the app backgrounded. The UI, save path, and
`run_routes` storage are reused unchanged; the web app is unaffected (a single bundle
serves both — `Capacitor.isNativePlatform()` is `false` in the browser).

**Build it locally** (needs Android Studio / the Android SDK + JDK 21):

```sh
npm install
npm run build              # → dist/
npx cap sync android       # copy web assets + native plugins into android/
npx cap open android       # open in Android Studio, run on a device/emulator
```

Debug builds need no signing. Release AABs for the Play Store are built by
`.github/workflows/android.yml` (manual or on an `android-v*` tag) and need these
extra repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

### Versioning & releases

Don't hand-edit the version — it's derived at build time, so a release is just a tag:

```sh
git tag android-v1.2.0 && git push origin android-v1.2.0
```

- **`versionName`** (e.g. `1.2.0`) comes from the `android-v*` tag.
- **`versionCode`** (what Play orders uploads by — must always increase) is the
  GitHub Actions **run number**, injected automatically. No manual bumping.
- Local/debug builds fall back to `1` / `1.0`.

### In-app update prompt

The app compares its installed `versionName` against the `app_config` row
(`supabase/migrations/20260623120000_app_config.sql`) on launch:

- `latest_version` — set **automatically** by the release workflow after a tagged
  build, so users on an older version see a dismissible "update available" banner.
- `min_supported_version` — **you bump this by hand** in Supabase only when you ship
  a breaking change; clients below it get a non-dismissible "update required" screen.

For the workflow to write `latest_version`, add two more repository secrets (the
service-role key bypasses RLS and must **never** be put in the app bundle — CI only):

| Secret | Value |
|--------|-------|
| `SUPABASE_URL` | your project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | *Settings → API → service_role* secret key |

### Install a build on your phone

Every PR builds a sideloadable **debug APK** via `.github/workflows/android-pr.yml`
(a bot comment links to it). To install one:

1. Download the `running-coach-pr<N>-debug-apk` artifact from the PR's workflow run
   and unzip it to get `app-debug.apk`. (Locally: `cd android && ./gradlew assembleDebug`
   → `android/app/build/outputs/apk/debug/app-debug.apk`.)
2. Get it onto the phone — easiest is `adb install app-debug.apk` over USB
   (enable **Developer options → USB debugging**), or transfer the file and tap it.
3. When tapping the file, Android asks to **allow installing unknown apps** for
   whichever app opened it (Files, Chrome, Drive) — allow it, then install.

The debug APK is signed with a throwaway debug key, so it can't be updated *over* a
Play Store install of the same app (uninstall one first). Background GPS, the
foreground-service notification, and the location prompts all work in debug builds —
no Play release or plugin license required.

> ⚠️ The PR APK uses the same `applicationId` (`solutions.camboulive.run`) and talks
> to the **production Supabase project** — runs you log from a test build are real
> data on your account.

**Before release**, three things must be configured outside the repo:

- **Supabase Auth → URL Configuration:** add `solutions.camboulive.run://auth-callback`
  to the redirect allow-list so OAuth / magic-link sign-in returns to the app.
- **MapTiler key origins:** the WebView's origin is **`https://localhost`**, not the
  web domain, so an origin-restricted key returns *"Invalid key"* and tiles won't
  load. Add `https://localhost` (and `http://localhost`) to the key's allowed
  origins in the MapTiler dashboard — see [Maps](#maps).
- **Play Console:** background location requires a prominent in-app disclosure, a
  public privacy policy URL, and the "Location permissions" declaration form
  justifying `ACCESS_BACKGROUND_LOCATION` (core feature: recording a run with the
  screen off). Test on an internal track first.

## Maps

Live GPS run tracking renders the route on a map using [MapTiler](https://www.maptiler.com/)
tiles. Without a key the tracker still records the run; only the map basemap
won't load (the app shows a small "needs key" notice instead of tiles). Raw
OpenStreetMap tiles are intentionally not used — the OSMF tile policy disallows
them for a multi-user app.

**Set the key as the `VITE_MAPTILER_KEY` build-time variable:**

- **CI / deploys:** add `VITE_MAPTILER_KEY` as a **repository secret**
  (*Settings → Secrets and variables → Actions*). Both `deploy.yml` and
  `deploy-pr.yml` read it in their build step and Vite inlines it into the
  bundle. The secret is read at build time, so a change only takes effect on the
  next deploy — re-run the workflow (or push a commit) after adding it.
- **Local dev:** put `VITE_MAPTILER_KEY=...` in a gitignored `.env.local` file.

> ⚠️ **A `VITE_*` value is NOT a secret in the deployed app.** Vite inlines it
> into the public JavaScript bundle, so anyone can read the key in their
> browser's dev tools — using a GitHub secret only keeps it out of the *source
> repo*, not out of the shipped site. The real protection is **restricting the
> key to your origin(s)** in the MapTiler dashboard
> (*Account → Keys → Allowed origins / HTTP referrers*): add your production
> domain (e.g. `https://run.camboulive.solutions`) so the key can't be lifted
> and used to drain your tile quota from another site. PR previews are served
> from the same origin, so one entry covers them too. Never use an unrestricted
> key here.
>
> **Android app:** the Capacitor WebView loads from `https://localhost`, *not* the
> web domain, so a key restricted only to the production domain returns
> *"Invalid key"* and tiles won't render (the run still records). Add
> `https://localhost` (and `http://localhost`) to the allowed origins so the app's
> map works too.

## Security

- A Content-Security-Policy is set in `index.html` as defence-in-depth.
- `.github/workflows/security.yml` runs Semgrep on every PR and push to `main`.
- The MapTiler key (`VITE_MAPTILER_KEY`) is inlined into the public bundle, so it
  must be **origin-restricted in the MapTiler dashboard** to your domain(s) — see
  [Maps](#maps). No default key ships in the source.
- Password policy lives in `supabase/config.toml` for local dev; the live project's
  policy must be set in the Supabase dashboard.

---

## Your data

When you sign up, the app stores:

- Your email address (for login)
- Your runs (date, distance, duration, HR, effort, notes)
- Your training plan and race settings
- Your name, if you enter one during onboarding

That's it. No tracking, no analytics, no ads.

I will never use your data for any purpose other than running the app, and I will never sell it or share it with third parties.

The app is open source — you can read exactly what gets stored in `supabase/migrations/` and `src/db.js`.

The workflow uses GitHub's OIDC provider to assume an AWS IAM role
(`aws-actions/configure-aws-credentials`) — no long-lived AWS keys stored in
GitHub.

### PR previews

`.github/workflows/deploy-pr.yml` deploys a preview for each pull request to its
own prefix in the same bucket — `s3://<bucket>/pr/<number>/`, served at
`https://run.camboulive.solutions/pr/<number>/index.html` — and removes it when
the PR is closed. The deployed URL is posted (and kept up to date) as a PR
comment. (CloudFront only resolves a default root object at `/`, so previews
link straight to `index.html`.)

Only the **code owners** listed in `.github/CODEOWNERS` trigger a preview: the
job is gated on the PR author having write access (`OWNER`/`MEMBER`/
`COLLABORATOR`), and because the workflow uses `pull_request` (not
`pull_request_target`), fork PRs cannot assume the deploy role. It reuses the
same OIDC role and CloudFront distribution as the production deploy.

---

## License

[MIT](LICENSE) — do whatever you want with it, just keep the copyright notice and give a shoutout to the original project if you reuse it.
