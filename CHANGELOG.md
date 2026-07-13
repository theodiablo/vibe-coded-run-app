# Changelog

All notable Android releases are documented here.

---

## [1.2.0] — 2026-07-13

### Health Connect integration
- **Watch run import** — connect Health Connect and import runs recorded on a
  Garmin, Amazfit or other watch, even when you left your phone at home. Distance,
  elevation and duration come across automatically, with cross-source dedupe so the
  same run is never logged twice.
- **Heart rate from your watch** — average and max heart rate for a run flow in
  from Health Connect (or a paired BLE sensor) and land in the run's HR fields,
  still fully editable.

### Training
- **Methodology styles** — pick balanced, polarized, run/walk, low-frequency or
  Hansons; your plan rebuilds around the chosen style while preserving progress.

### Other
- Refreshed race discovery card (date-first, visible distances).
- Fixed a crash on sign-out when the marketing chunk failed to load.

**Full changelog:** #60, #62, #63, #64

---

## [1.1.0] — 2026-06-28

### Races & Badges (Gamification Phase 1)
- **Race Catalogue** — browse a curated list of global majors (Berlin, London, Boston, Tokyo, Chicago, NYC, Valencia, Seville, Paris Marathon, and more) and wishlist upcoming editions.
- **Race Tracking** — log results for completed races and track personal bests across editions.
- **Promote to training target** — one tap sets a race edition as your plan's target, prefilling date and distance in Plan setup.
- **Auto-detect race completion** — a run logged on your race day at the matching distance (±18%) triggers an undoable "mark done" toast.
- **Badges** — inclusive progression badges earned from cumulative active weeks, walk sessions, and race completions; new-unlock toasts appear when you earn one, with a "next badge" teaser on the Dashboard.
- **Refreshed navigation** — Record is now a center FAB (action, not a destination); History and Stats merge into a new **Progress** tab that also hosts Badges.

### Bug Fix — Telemetry
- Fixed a CSP issue where consent-based analytics events were silently blocked; PostHog events now correctly reach the ingestion endpoint on both web and the Android WebView.

### Internal
- Android CI now gates builds exclusively on `android-v*` tags and manual dispatch, eliminating noisy failing `0.0.0` builds on ordinary branch pushes.

**Full changelog:** #28, #29, #30

---

## [1.0.0] — 2026-06-26

First release.
