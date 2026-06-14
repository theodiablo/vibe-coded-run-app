# Running Coach

A training-log app for 20K race prep, built with Vite + React + Tailwind.
Sign-in and per-user data (runs, plan, settings) are handled by Supabase;
each signed-in user's data lives in their own row, protected by row-level
security.

## Develop

```sh
npm install
npm run dev
```

## Test

```sh
npm test         # run the Vitest suite once
npm run test:watch
```

## Build

```sh
npm run build   # outputs to dist/
npm run preview
```

## Configuration

The Supabase URL and **publishable (anon)** key are read from `VITE_SUPABASE_URL`
and `VITE_SUPABASE_ANON_KEY` at build time, with public-safe defaults baked in so
a static build works without extra config. The anon key grants nothing on its
own — row-level security is the real boundary, and the secret key must never be
committed.

## Security

- A Content-Security-Policy is set in `index.html` as defence-in-depth.
- `.github/workflows/security.yml` runs Semgrep on every PR and push to `main`.
- Password policy lives in `supabase/config.toml` for local dev; the live
  project's policy must be set in the Supabase dashboard.

## Deployment (S3 + CloudFront via GitHub Actions)

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds the app
and syncs `dist/` to an S3 bucket, then invalidates the CloudFront distribution.

Configure these repository secrets:

- `AWS_REGION` — e.g. `eu-west-3`
- `AWS_DEPLOY_ROLE_ARN` — IAM role ARN assumable via OIDC (with permissions to write to the S3 bucket and create CloudFront invalidations)
- `S3_BUCKET_NAME` — target bucket name
- `CLOUDFRONT_DISTRIBUTION_ID` — distribution to invalidate after each deploy

The workflow uses GitHub's OIDC provider to assume an AWS IAM role
(`aws-actions/configure-aws-credentials`) — no long-lived AWS keys stored in
GitHub.
