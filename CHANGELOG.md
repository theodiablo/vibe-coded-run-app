# Changelog

All notable Android releases are documented here.

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
