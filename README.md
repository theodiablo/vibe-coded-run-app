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

In your Supabase project, open the **SQL Editor** and run the three migration files
in order from `supabase/migrations/`:

1. `20260607114706_init_schema.sql`
2. `20260607165159_grant_table_privileges.sql`
3. `20260614120000_harden_security_definer_functions.sql`

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

Live GPS run tracking renders the route on a map using [MapTiler](https://www.maptiler.com/)
tiles. Set `VITE_MAPTILER_KEY` to a publishable (domain-restricted) MapTiler key
at build time. Without it the tracker still records the run; only the map basemap
won't load. Raw OpenStreetMap tiles are intentionally not used — the OSMF tile
policy disallows them for a multi-user app.

## Security

- A Content-Security-Policy is set in `index.html` as defence-in-depth.
- `.github/workflows/security.yml` runs Semgrep on every PR and push to `main`.
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
