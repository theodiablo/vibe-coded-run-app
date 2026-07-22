---
name: screenshot-refresh
description: Refresh the full-page design-review screenshots of the deployed Running Coach app (mobile + desktop) in screenshots/, using the standalone Playwright tool already committed there. Use this whenever the user asks to refresh, retake, redo, regenerate, or update the app's screenshots, wants a fresh screenshot pass for a design review, or asks for a full walkthrough capture of the app's screens.
---

# Screenshot refresh

`screenshots/` in this repo is a **self-contained Playwright tool** (its own
`package.json`, not a dependency of the main app) that logs into the deployed
app at `run.camboulive.solutions` and takes full-page screenshots of every
major screen, at both mobile (390×844) and desktop (1440×900) sizes. It
exists so a design review always has an up-to-date, complete set of screens
instead of stale or hand-picked ones.

Read `screenshots/README.md` first — it documents the exact commands, the
screens covered, and known quirks (Tailwind `fixed` elements needing special
handling in full-page captures, no distinct desktop layout in the app itself,
etc.). Don't duplicate that content here; this file is about *when and how to
run it*, not what it contains.

## Why this exists instead of browser-extension automation

An earlier attempt used the `claude-in-chrome` MCP tools (browser extension
automation). Two things about that approach didn't hold up in this repo's
environment (worth reading before assuming Playwright is overkill and trying
extension automation again):

- **No full-page screenshots** — the extension's `computer` tool only
  captures the current viewport; scrolled-past content needs multiple manual
  screenshots stitched by eye, not a real `fullPage` capture.
- **No reachable local file path** — screenshots saved via that tool land in
  Claude Cloud session storage, not on the machine's actual disk, so they
  can't be committed to the repo or hand off to another local tool.

Playwright, run directly via Bash on this machine, solves both: real
`page.screenshot({ fullPage: true })`, writing straight to a path this
session's file tools can read, edit, and commit.

## Running it

1. `cd screenshots && npm install` (installs the pinned `playwright` version;
   fast if `node_modules` already exists from a previous run).
2. Make sure the matching Chromium build is cached: `npx playwright install
   chromium`. This is a no-op if it's already downloaded, so always safe to
   run.
3. **Log in once per refresh:** `node login.js`. This launches a real,
   visible Chromium window against the production site and waits (up to 5
   minutes) for the dashboard to appear. **Tell the user to log in there
   themselves** — never type credentials into that window even if the user
   pastes them in chat; entering login credentials to authenticate is
   something to always defer to the human for. On success it saves the
   logged-in session to `auth.json` (gitignored — it's live session state,
   never commit it).
4. `node capture.js` (or `capture:mobile` / `capture:desktop` individually)
   walks both viewports through every screen and overwrites the PNGs in
   `mobile/` and `desktop/`.
5. Skim a couple of the refreshed PNGs (Read tool) to sanity-check nothing
   broke — e.g. a UI change could shift where a button is and make a click
   silently miss (most steps in `capture.js` are wrapped in `isVisible()`
   checks, so a broken step usually just skips its screenshot rather than
   crashing loudly).
6. Show `git status`/`git diff --stat` on `screenshots/` so the user can see
   what actually changed before deciding whether to commit.

## If the app's UI has changed since this was written

`capture.js`'s click path depends on a handful of selectors tied to the
current UI (`button[aria-label="Record a run"]`, `button[aria-label="Settings"]`,
`button[aria-label="Close"]`, `button:text-is("Coach")`, plus some literal
`text=` matches for nav items and tab labels). If a screen comes back empty,
wrong, or a step silently no-ops, that selector likely needs updating to
match whatever the UI changed to — update `capture.js` in place rather than
routing around it with one-off inline scripts, so the fix benefits every
future refresh.

## After refreshing

Don't commit or push automatically — ask whether the user wants the refreshed
screenshots committed, following this repo's normal git workflow (`CLAUDE.md`
in the repo root covers the standing PR-opening policy; direct pushes to
`main` are blocked by an auto-mode safety rule, so a push needs to go through
the user themselves or a PR).
