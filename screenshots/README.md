# Screenshots

Full-page captures of the main app screens, kept for reference (design
reviews, docs, before/after comparisons). Two viewports:

- `mobile/` — 390×844 (iPhone-ish)
- `desktop/` — 1440×900

Both against the live production site (`run.camboulive.solutions`), logged in
as a real account, dark theme.

## What's captured

Per viewport: Home, Plan (+ a week expanded), Coach chat, Record a run (+ the
live GPS tracker), Races (My Races, Find a race, a race's detail expanded),
Progress (Log, Stats, Badges), Settings. See `capture.js` for the exact click
path if you want to extend it.

## How to (re-)run this

These are Playwright scripts, run standalone — they're not part of the app's
own test suite or `package.json`.

1. Install Playwright once (from this `screenshots/` folder or anywhere):
   ```
   npm install playwright
   npx playwright install chromium
   ```
2. Log in once. This opens a real, visible Chromium window against
   `run.camboulive.solutions` — log in there by hand (this script never
   touches or stores your password, only the resulting session):
   ```
   node login.js
   ```
   It waits for the dashboard to appear, then saves the logged-in session to
   `auth.json` next to this README. **`auth.json` is gitignored — it's live
   session state, never commit it.**
3. Capture:
   ```
   node capture.js          # both viewports
   node capture.js mobile   # just one
   node capture.js desktop
   ```
   Screenshots land in `mobile/` and `desktop/`, overwriting any existing
   files with the same name.

## Notes / known quirks

- Full-page screenshots are real (`page.screenshot({ fullPage: true })`), not
  a stitched approximation — scrolled-past content is genuinely captured.
- Tailwind's `fixed` utility (nav bar, modal overlays) fights full-page
  capture: a truly `fixed` element gets pinned to the viewport and repeats at
  every scroll offset when Playwright stitches the page. `capture.js` works
  around this by temporarily neutralizing `.fixed` positioning (and, when a
  modal is open, hiding the rest of the page so it can't bleed through below
  the modal's real content) just for the screenshot, then restoring it. Net
  effect: the bottom nav bar renders correctly full-width only in each
  viewport's very first `01-home.png`; in the rest of that viewport's shots
  it appears squished at the very bottom — that's a capture artifact, not a
  real rendering bug.
- At the 1440×900 desktop viewport the app itself doesn't have a distinct
  desktop layout — content stays mobile-width and centered, nav pinned
  bottom-left. That one's real, not a capture artifact — worth knowing before
  reading the desktop screenshots as "the desktop design."
- Selectors in `capture.js` are hand-picked against the current UI (e.g.
  `button[aria-label="Record a run"]`, `button[aria-label="Settings"]`,
  `button[aria-label="Close"]`, `button:text-is("Coach")`). If the app markup
  changes, some steps may silently no-op (most are wrapped in `isVisible()`
  checks) rather than throw — spot-check the output.
