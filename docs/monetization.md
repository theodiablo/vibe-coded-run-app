# Monetization

Durable product decision for how (and how not) to make money from Running Coach.
Read this before adding a paywall, a pricing section, an entitlement/tier
concept, or any change to the coach rate limit. The load-bearing rules are also
summarized in `CLAUDE.md`; this file holds the reasoning.

## Direction (the decision)

- **The app stays free.** Everything a runner needs to train — plans, GPS
  tracking, the community race catalogue, and the AI coach — is free. The
  marketing promise is deliberately worded "everything you need to train is
  free" (not the absolute "free includes everything") so a future paid tier of
  *new* features never contradicts the page.
- **A paid tier, when it comes, is built from _new_ premium-only value — never
  by taking something away.** Never move an existing free feature behind a
  paywall, and never lower `RATE_LIMIT_PER_DAY` to force upgrades. New headline
  features should land premium-first so nothing is ever clawed back from free
  users.
- **The coach daily limit is cost-insurance, not a monetization lever.** See the
  cost analysis below: real usage is far below even a low cap, so a limit-based
  paywall would convert nobody. `RATE_LIMIT_PER_DAY` exists to bound the blast
  radius of a runaway/abusive user, not to sell upgrades.

## Cost of the free tier

Measured from production `agent_rounds` (2026-07, ~2 weeks of real usage):

- The coach runs on `claude-sonnet-5` (`COACH_MODEL`, `max_tokens: 4096`,
  system prompt cached). Only `propose`/`critique` rounds are charged against
  the daily limit.
- Average charged round: ~13k input + ~1.75k output tokens (p90 ~21k/3.4k).
- Sonnet 5 pricing $3/M in, $15/M out ⇒ **≈ €0.06 per coach query** (a bit less
  during any introductory pricing window).
- Worst case for one user maxing a 20/day limit: ~€36/month. At 5/day: ~€9/month.
- **Actual usage is tiny**: ~25 charged rounds *total across all users* in two
  weeks (≈ €1.6 total). Nobody is near the limit.

Implication: tightening the limit saves almost nothing and sells nothing. The
limit is a safety valve; monetization must come from new value.

## Options considered

- **Freemium subscription (recommended paid path).** A "Supporter" tier of new
  proactive-coach features (see below). Price aligns with cost because these
  features genuinely consume more model tokens. Suggested price ~€4.99/month
  (nets ~€4.24 after the 15% store small-business cut, comfortably covering a
  heavy user), or ~€3.99 as an impulse price; annual ~€34.99–39.99. In-app sales
  must use Play Billing / Apple IAP; web can use Stripe. RevenueCat can unify all
  three behind one entitlement source (its webhook writes a per-user entitlement
  row that `checkRateLimit` reads instead of the global env var).
- **Tip jar (shipped).** Buy Me a Coffee link in the marketing footer
  (`TIP_JAR_URL`, web-only by construction — Apple rejects external payment
  links in the iOS app). Near-zero effort; gauges goodwill; funds the coach's
  API cost. Live today.
- **One-time "lifetime" unlock.** Mismatched with the coach's *recurring* API
  cost; only sensible for non-AI perks. Not the primary model.
- **Ads.** Rejected — clashes with the privacy-first positioning (opt-in
  telemetry, no autocapture), earns cents at this scale, and would be hostile UX
  during a run.
- **Affiliates / partnerships around the race catalogue.** Race-registration
  affiliate links or featured local-race listings monetize the catalogue without
  charging users. A later-stage complement once there's meaningful traffic;
  requires disclosure.
- **B2B / coach marketplace / white-label.** A real business but a large product
  pivot, out of scope for "small income."

## What a paid tier would actually contain

Premium value should be _new_, and the app's own architecture points at the
strongest candidates:

1. **Proactive coach (best fit — cost-aligned).** Today the coach is reactive
   (user opens the chat). Premium flips it proactive, reusing the existing engine
   + validator + safety rules through new entry points:
   - Post-run feedback: a short coach note after each saved run (pace vs plan,
     HR drift, "ease up tomorrow").
   - Weekly review: a scheduled round that reviews the week vs the plan and
     *proposes* next-week adjustments via the existing propose-and-confirm flow.
   - Race strategy: an elevation-aware pacing plan with a coach narrative.
   These consume more model tokens, so price aligns with cost — and they mirror
   what paid running apps charge for.
2. **Deep analytics (zero marginal cost).** Training-load / fitness-fatigue
   trends, HR-drift and zone distribution over time, a race-time predictor, PB
   history — all computable client-side from existing `runs` data. The
   Strava-premium model.
3. **Convenience:** calendar export (.ics), richer multi-race handling. Bundle
   filler, weak on its own.

## Sequence

1. **Now:** tip jar (done) — real money possible today, no vaporware tier.
2. **When ready to charge:** the proactive-coach Supporter tier — entitlements
   table + RevenueCat (Play Billing + StoreKit + Stripe web) + per-user limit in
   `checkRateLimit` + an upsell on the `RATE_LIMIT` error, plus an honest pricing
   section in `src/marketing/marketing.*.json` (keep the free tier's non-numeric
   fair-use phrasing true).
3. **Later, with traffic:** race-registration affiliates/partnerships via the
   catalogue.

At current (beta) scale, growth matters more than conversion — but the
premium-first / never-claw-back rule is decided **now** so nothing has to be
walked back later.
