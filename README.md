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

If you're in the same boat, feel free to use it, fork it, or suggest features. All feedback is welcome!

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

## Develop locally

```sh
npm install
npm run dev
```

## Test

```sh
npm test              # run the Vitest suite once
npm run test:watch    # watch mode
```

## Build

```sh
npm run build    # outputs to dist/
npm run preview
```

---

## Configuration

The Supabase URL and **publishable (anon)** key are read from `VITE_SUPABASE_URL`
and `VITE_SUPABASE_ANON_KEY` at build time, with public-safe defaults baked in so
a static build works without extra config. The anon key grants nothing on its own —
row-level security is the real boundary, and the secret key must never be committed.

---

## Security

- A Content-Security-Policy is set in `index.html` as defence-in-depth.
- `.github/workflows/security.yml` runs Semgrep on every PR and push to `main`.
- Password policy lives in `supabase/config.toml` for local dev; the live project's
  policy must be set in the Supabase dashboard.

---

## Deployment (S3 + CloudFront via GitHub Actions)

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds the app and
syncs `dist/` to an S3 bucket, then invalidates the CloudFront distribution.

Configure these repository secrets:

| Secret | Value |
|--------|-------|
| `AWS_REGION` | e.g. `eu-west-3` |
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN assumable via OIDC |
| `S3_BUCKET_NAME` | target bucket name |
| `CLOUDFRONT_DISTRIBUTION_ID` | distribution to invalidate after each deploy |

The IAM role needs: `cloudfront:CreateInvalidation`, `cloudfront:ListResponseHeadersPolicies`,
`cloudfront:CreateResponseHeadersPolicy`, `cloudfront:GetResponseHeadersPolicy`,
`cloudfront:UpdateResponseHeadersPolicy`, `cloudfront:GetDistributionConfig`,
`cloudfront:UpdateDistribution`, and write access to the S3 bucket.

The workflow uses GitHub's OIDC provider to assume the role — no long-lived AWS keys
stored in GitHub.
