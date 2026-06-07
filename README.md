# Running Coach

A standalone training-log + AI coach app for 20K race prep. Built with Vite + React + Tailwind. All data (runs, plan, settings, API key) is stored in the browser's `localStorage` — nothing is sent to a server except direct calls to Anthropic's API from the Coach tab.

## Develop

```sh
npm install
npm run dev
```

## Build

```sh
npm run build   # outputs to dist/
npm run preview
```

## Claude API key

The Coach tab calls `api.anthropic.com` directly from the browser using the
`anthropic-dangerous-direct-browser-access` header. Each user pastes their own
API key (from console.anthropic.com) via the "Set API key" button in the header;
it's stored only in that browser's `localStorage`.

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
