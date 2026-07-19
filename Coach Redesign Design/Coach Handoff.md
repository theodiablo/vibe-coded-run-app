# Coach redesign — implementation handoff (design 3a)

Final design: `Coach Redesign.dc.html`, section **3a** (screens 1–5). Combines the bottom-sheet history (1b) with a bottom-right usage ring (2b). Backend/data work follows the engineering plan already agreed (5/day limit, `usage` action, `coachHistory.ts`, `coachTranscript.ts`); this doc covers the UI layer decisions the mockups lock in.

## Usage ring (screens 1, 2, 5)
- Donut ring, ~18px, bottom-right of the footer, on the privacy line row, right-aligned. Fill fraction = `used / limit` (conic sweep, clockwise from 12 o'clock).
- Track `#26334a`. Fill color by usage: **< 60%** slate `#64748b` (no label — subtle); **60–79%** amber `#fbbf24` + label "N left today"; **≥ 80%** red `#f87171` + label. At 100% label reads "resets tomorrow", composer disabled + limit-reached banner (screen 5), chips hidden.
- Label sits left of the ring, 12px, same color as ring fill.
- `usage === null` (old function / error): render nothing, disable nothing.
- Tap ring → popover (screen 2): title "Coach usage", "resets at midnight" right-aligned, one progress bar "Daily requests · N of M used", footnote "Applying changes, browsing history, and flagging answers don't count." Popover anchors above the ring, dismiss on outside tap/Escape. **Reserved slot for a future Premium upsell row — do not build it now.**
- Note: thresholds are % of limit, not fixed counts, so a `coach_daily_limit` override keeps sensible behavior. Replaces the plan's `usageTone` boundaries: `normal < 0.6`, `warn ≥ 0.6`, `critical ≥ 0.8`, `exhausted = 1`.

## History (screens 3, 4)
- Header gains a history icon button (lucide `History`, aria-labelled), left of close. Always enabled.
- Opens a **bottom sheet** (not a full-screen panel — supersedes plan step 4a's full-screen layout; keep the same component boundaries/`useDismissable` LIFO behavior): dimmed scrim `rgba(4,8,15,0.55)`, sheet `#0f1a2b`, top radius 20px, grab handle, max-height ~72%, `animate-slide-up`.
- Sheet header: "Conversations" + "last 30 days" hint. Rows: 1-line ellipsized preview (round-0 report, prefix stripped), date (`fmt.sht`), right-aligned status tag: CONTINUE (orange, open row also gets orange border `#f9731640` + bg `#152238`), APPLIED (`#34d399`), CLOSED (slate), NO CHANGE (slate).
- Tap open row → resume in place (sheet closes, transcript loads, composer live). Tap closed row → read-only transcript (screen 4): status chip in header, back chevron, footer = "This conversation is closed — you can read it but not reply." + full-width orange "Start a new conversation" button resetting to `initialMsgs()`. No Apply on closed transcripts.
- States: loading / empty / load-failed + retry per plan step 4a.

## Palette / type (matches app)
bg `#0b1220`, card `#141f31`/`#101a2a`, borders `#1f2c42`/`#24324a`, coach bubble `#141f31`, user bubble `#1d3a5f`, proposal card `#12203a` border `#2a4a7a` label `#7fb3f5`, accent orange `#f97316` (btn `#c2571b`), text `#e2e8f0`/`#cbd5e1`, muted `#64748b`/`#526075`, amber `#fbbf24`, red `#f87171`, emerald `#34d399`. System sans, sizes as in mockups.

## i18n additions beyond the plan
`coach.usage.detail.{title,resets,dailyRequests,used,freeActions}` for the popover; keep the plan's `coach.usage.left` / `coach.usage.limitReached`; status tag `coach.history.status.no_valid_adjustment` renders "No change".
