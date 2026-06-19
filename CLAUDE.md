# Running Coach

A React 19 + Vite single-page running-training app. No backend logic of note —
all state is client-side and persisted locally (Supabase client is present but
the app runs offline-first via `db`).

## Commands
- `npm install` — **run first in a fresh checkout**; deps are not committed, so
  `lint`/`test`/`build` all fail with module-not-found until you do.
- `npm run dev` — local dev server (Vite).
- `npm test` — Vitest (run mode). `npm run test:watch` for watch.
- `npm run lint` — ESLint (flat config). Catches unused imports/vars; keep it clean.
- `npm run build` — production build.

## Architecture
- `src/RunningCoach.jsx` is the **single state hub**: it owns `runs`, `plan`,
  `settings`, modal flags, and the active `tab`, and passes a `shared` props bag
  down to every view. Add cross-view state and persistence here.
- **Persistence:** `db.get/set(STORAGE_KEYS.*)` (`src/db.js`, `src/constants.js`).
  State changes are mirrored to `db` in the same handler that calls `setState`.
- **Layout:** views in `src/views/`, modals/full-screen flows in `src/modals/`,
  reusable widgets in `src/components/`, pure helpers in `src/utils/`.
- `settings` is the central config object (race fields, HR profile, `planSessions`,
  `name`, `onboarded`). The training plan is (re)built by
  `buildPlan(raceDate, goalSec, planSessions, distanceKm, raceElevation)`
  (`src/utils/plan.js`).

## Conventions
- Reuse existing form pieces rather than re-rolling inputs: `SessionConfigurator`
  (training days), `INPUT_CLS` (`src/constants.js`) for input styling, and the
  `fmt` helpers (`src/utils/format.js`) for durations/paces.
- Tailwind utility classes inline; dark slate palette with orange-500 accents.
- First-run onboarding lives in `src/modals/OnboardingWizard.jsx` (Name → Plan →
  Heart rate). It's gated by `settings.onboarded` (and legacy `settings.name`);
  set `onboarded: true` whenever you complete or dismiss a first-run flow so it
  doesn't re-trigger.
