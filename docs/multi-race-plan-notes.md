# Handoff — Multi-race training plan (planning kickoff)

Purpose: kick off design for letting a training plan include **several races**
(e.g. *San Sebastián 10K · Oct 2026* + *Behobia · Nov 2026* + *Barcelona
Marathon · Mar 2027*). This brief is self-contained so a fresh conversation can
start planning without re-deriving context. **Planning only — no implementation
decisions are locked yet.**

## Where we are (already shipped — gamification Phase 1)
On branch `claude/gamification-feature-brainstorm-dadh1l`:
- **Race catalogue** (Race → Edition), read-only bundled seed: `src/data/races.js`;
  lookups via `src/utils/races.js` (`allEditions`, `findEdition`, `editionLabel`).
- **Personal layer** in the synced blob under `STORAGE_KEYS.RACES` (`rc_races`):
  `{participations:[{editionId, raceId, label, raceDate, distanceKm, status, timeSec, runId, source, notes}], seenBadges:[]}`.
- **One training target**: `settings.targetEditionId` + scalar `settings.raceDate/
  distanceKm/goalSec/raceElevation`. Promote via `promoteEdition` (`RunningCoach.jsx`)
  → prefilled `PlanView` setup → `buildPlan` → sets `targetEditionId`.
- **Completion**: manual "log result" (RacesView) or undoable race-day auto-detect
  (`detectRaceCompletion`/`detectCompletion` in `RunningCoach.jsx`).
- **Badges**: pure `computeBadges(runs, participations)` (`src/utils/badges.js`),
  reconciled in event handlers (not effects).
- **Nav**: Record = center FAB; tabs Home · Plan · Races · Progress.

See the "Races & badges (gamification)" section in `CLAUDE.md` for the durable rules.

## The goal of step 2
Let one plan train *through* intermediate races toward a primary race — textbook
A-race + tune-up periodization. "Integrate into the plan" means the tune-ups live
inside the schedule (and ideally shape it), not just sit in a wishlist.

## Approach spectrum (recommendation: start at "Overlay + light adjust")
1. **Overlay (light):** one A-race drives periodization; other races drop onto the
   timeline as `RACE` sessions (visible in plan, on dashboard, auto-complete on the
   day). Simple, low risk.
2. **Overlay + light taper/recovery (recommended):** as above, plus a few easier
   days before each tune-up and an easy day or two after — respects the races
   without rewriting periodization.
3. **Full multi-block (heavy):** chain distinct blocks between races. Most correct,
   biggest rewrite.

## Open decisions (carry into the planning chat — currently undecided)
1. **Model:** one A-race + tune-ups, vs. all races equal. (Recommend A-race + tune-ups.)
2. **Training effect:** overlay-only / overlay+light taper / full re-periodization.
   (Recommend overlay + light taper.)
3. **Per-race goals:** goal on the A-race only (tune-ups = effort, time logged
   after), vs. a goal time per race. (Recommend A-race only.)
4. **Adding races:** pick from wishlist in plan setup, vs. auto-include all
   wishlisted races before the A-race. (Recommend explicit pick.)

## What to be careful about

### Single-race assumptions to refactor
- `settings` is scalar (`raceDate/distanceKm/goalSec/raceElevation` + one
  `targetEditionId`), read directly by the Dashboard race card, `PlanView`, and
  auto-detect. Decide: keep these as "the A-race" (back-compat) **plus** a new
  `planRaces[]`, or migrate fully.
- `buildPlan(raceDate, goalSec, planSessions, distanceKm, raceElevation)`
  (`src/utils/plan.js`) is positional/single-race. Callers: onboarding complete
  (`RunningCoach.jsx`), `PlanView.genPlan`, `plan.test.js`. Prefer an **additive
  options object/overload** over changing the signature everywhere at once.
- The decouple-on-edit rule in `PlanView.genPlan` (clear `targetEditionId` when the
  race is hand-edited) must generalize to a set.

### Plan-engine correctness
- Phases (BASE/BUILD/PEAK/TAPER/RACE) + week numbering are derived from the
  race-date span — inserting intermediate races must not corrupt them.
- A tune-up date may not fall on a configured `planSessions` day → define collision
  behavior (replace/add/move).
- Taper/recovery rules scaled to tune-up size vs. training load (don't over-taper a
  parkrun; mind ultras like UTMB 171 km where `paceBand`/`goal.js`/`predictions.js`
  math may not apply).
- Training paces derive from the **A-race goal** — tune-ups without their own goal
  must not skew them.
- Keep `buildPlan` pure/deterministic (testable). Honor "derived-state resets during
  render, not effects" (`PlanView` `prevPlan`). Regeneration wipes done/skipped —
  warn the user.

### Date/ordering edge cases
- Tune-up after the A-race or in the past; two races same week/day; A-race date
  changed after tune-ups chosen; window too short for a taper. Parse dates locally
  (`ymd`, `new Date(s+"T00:00:00")`).

### Gamification interactions (don't regress)
- Auto-detect currently keys on the single `targetEditionId`/`settings.raceDate`;
  must check a logged run against **all** plan races, no double-marking, keeping the
  `addRuns(..., {skipDetect:true})` path used by manual logging.
- Race-day "pick your next race" loop should fire only when the **A-race** completes.
- Ensure plan races still flow through `participations` so race/PB badges work and
  nothing is double-counted.

### Persistence / telemetry
- Any new shape → add to **both** `BackupModal` data and `handleRestore`
  (`RunningCoach.jsx`). Keep blob writes small (debounced upsert).
- Migrate existing single-target users on load without breaking (keep failure-
  tolerant fallback).
- New telemetry events through the seam only, **anonymous** (counts/enums, never
  names/dates); document in `docs/telemetry.md` + `CLAUDE.md`.

### UX
- Setup: choose A-race + tick tune-ups; reuse `GoalConfigurator`/`SessionConfigurator`;
  extend the new promote banner (`PromoteBanner` in `PlanView.jsx`) rather than
  fighting it.
- Dashboard race card shows one race + countdown today — decide next-race vs A-race
  emphasis. Distinguish A-race vs tune-up visually (`TCLR.RACE`).
- Allow removing/editing one race without nuking the whole plan or its done-state.

## Suggested sequencing
- Phase it: overlay-only first, then light taper/recovery — keep tests green at each
  step.
- Test pure first: extend `plan.test.js` for insertion, ordering, collisions, taper,
  and multi-race detection before wiring UI.
- Keep catalogue lookups through `src/utils/races.js` (Phase 2 shared-table swap).
- Keep the web build unchanged for users who don't use it.

## Key files
- `src/utils/plan.js` (`buildPlan`) — the engine to extend.
- `src/RunningCoach.jsx` — state hub: `settings`, `promoteEdition`, `addRuns`
  auto-detect, badge reconcile, backup/restore.
- `src/views/PlanView.jsx` — setup/edit + promote flow (`PromoteBanner`, `genPlan`).
- `src/views/RacesView.jsx` — where races are wishlisted / set as target.
- `src/utils/races.js`, `src/data/races.js` — catalogue + helpers.
- `src/views/Dashboard.jsx` — race card + next session.
- Tests: `src/utils/plan.test.js`, `src/utils/races.test.js`.

## Verify (per change)
`npm install` once; then `npm run lint`, `npm test`, `npm run build`. App is
auth-gated (Supabase), so live walkthrough needs credentials; lean on unit tests
for the engine. Confirm existing single-race plans still load/build (back-compat).
