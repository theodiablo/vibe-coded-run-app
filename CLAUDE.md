# Running Coach

A React 19 + Vite single-page running-training app. State is client-side and
mirrored through `db` into an in-memory cache that debounce-upserts to a single
per-user Supabase `app_state` JSONB row. It's failure-tolerant: a failed load
falls back to an empty cache so the app still renders.

## Commands
- `npm install` — **run first in a fresh checkout**; deps are not committed, so
  `lint`/`test`/`build` all fail with module-not-found until you do. (`vite` /
  `vitest` aren't on PATH otherwise — use the npm scripts or `npx`.)
- `npm run dev` — local dev server (Vite).
- `npm test` — Vitest (run mode). `npm run test:watch` for watch. Suite lives in
  `src/utils/*.test.js`.
- `npm run lint` — ESLint (flat config). Catches unused imports/vars; keep it clean.
- `npm run build` — production build.

## Architecture
- **No router.** `src/RunningCoach.jsx` is the **single state hub**: it owns
  `runs`, `plan`, `settings`, modal flags, and the active `tab`, and passes a
  `shared` props bag down to every view. The five views switch on `tab`
  (`dash`, `plan`, `log`, `history`, `stats`).
- To add cross-view state or an action, define it in `RunningCoach.jsx` and add
  it to `shared` (e.g. `goTab`, `goLog`, `addRuns`, `toggleSess`).
- **Persistence:** `db.get/set(STORAGE_KEYS.*)` (`src/db.js`, `src/constants.js`;
  keys `rc_runs`, `rc_plan`, `rc_settings`). Every state change is mirrored to
  `db` in the same handler that calls `setState`. Writes debounce ~600ms into a
  single upsert and flush on page hide/unload.
- **Derived-state resets are done during render, not in effects** — see the
  `if (plan !== prevPlan)` pattern in `PlanView.jsx`. Follow that style.
- **Layout:** views in `src/views/`, modals/full-screen flows in `src/modals/`,
  reusable widgets in `src/components/`, pure helpers in `src/utils/`.
- `settings` is the central config object (race fields, HR profile, `planSessions`,
  `name`, `onboarded`). The training plan is (re)built by
  `buildPlan(raceDate, goalSec, planSessions, distanceKm, raceElevation)`
  (`src/utils/plan.js`).

## Data shapes
- **Run:** `{id, date, type, km, durationSec, hr, hrMax, elevation, effort, notes}`.
  `id` is generated in `addRuns` if absent; runs are kept sorted newest-first.
- **Plan:** `buildPlan(...)` → `{..., weeks:[{weekNumber, startDate, phase,
  sessions:[{id, date, type, desc, km, pace, done}]}]}`.
  Session types: EASY, TEMPO, INTERVALS, LONG, RACE, WALK, OTHER.

## Conventions
- Reuse existing form pieces rather than re-rolling inputs: `SessionConfigurator`
  (training days), `INPUT_CLS` / `LABEL_CLS` (`src/constants.js`) for input
  styling, type colors `TCLR`, day names `DAYS`.
- Tailwind utility classes inline; dark slate palette with orange-500 accents.
- Dates are `YYYY-MM-DD` strings; use `ymd()` and the `fmt.*` helpers
  (`src/utils/format.js`) for durations/paces. Parse local dates as
  `new Date(s + "T00:00:00")`.
- First-run onboarding lives in `src/modals/OnboardingWizard.jsx` (Name → Plan →
  Heart rate). It's gated in `RunningCoach.jsx` by `settings.onboarded` (and legacy
  `settings.name`); set `onboarded: true` whenever you complete or dismiss a
  first-run flow so it doesn't re-trigger.
- Onboarding **persists per-step**: each step saves its entered data plus an
  `onboardStep` index via `onSaveProgress`, so a mid-flow refresh resumes on the
  same step. The gate treats a set `onboardStep` (with `!onboarded`) as "in
  progress, resume" — so don't key first-run detection on `name` alone, and clear
  the marker (`onboardStep: 0`) on complete/skip.
- `LogView` accepts a `prefill` prop and an `onSaved` callback (fires only on a
  real manual save, not CSV import/cancel) — used to log a run straight from a
  plan session and auto-tick it.

## Git / PR workflow
- Do not open or merge PRs unless explicitly asked.
- We squash-merge PRs. After a squash-merge, a branch that keeps being reused
  **diverges from `main`** and the next merge hits a conflict. Before merging
  again on the same branch: `git fetch origin main && git rebase origin/main`
  (the old squashed commit is auto-skipped), then `git push --force-with-lease`.
