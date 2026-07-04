# Coach agent — architecture & operations

A propose-and-confirm AI agent that **adapts** the existing training plan
through a bounded set of typed tools. The deterministic generator
(`src/utils/plan.js` `buildPlan`) stays the author of plan structure; the model
is an **editor, never an author**.

```
Browser (CoachChat) ──message──▶ Edge Function coach-agent ──▶ Anthropic API
     ▲    │                          │        │
     │    └─ confirm ──▶ returns plan│        └─ service role → agent_* audit log
     │                               └─ user JWT → reads app_state (RLS)
     └─ applies accepted plan via savePlan/db.set (user JWT, RLS)
```

## Invariants (do not break)

1. **Trust boundary** — the API key, the validator, the tool implementations,
   the rate limit, and the audit log live in the edge function. The client
   sends a message and renders the proposal.
2. **Editor, never author** — the model acts only through the six tools in
   `supabase/functions/_shared/coach/tools.mjs`. No free-text plan generation.
3. **One validator, two callers** — `validatePlan`
   (`supabase/functions/_shared/coach/validation.mjs`) is shared by the agent
   path and confirmed against `buildPlan` output by
   `src/utils/coachValidation.test.js`. The app re-exports it as
   `src/utils/coachValidation.js`.
4. **An invalid plan is never surfaced** — `generateProposal`
   (`_shared/coach/engine.mjs`) runs an internal validate-and-retry loop
   (bounded by `MAX_VALIDATOR_RETRIES`); on exhaustion the round ends in the
   distinct `no_valid_adjustment` fate, not a 500 and not a broken plan.
   Exhausting `MAX_MODEL_CALLS` instead (the model kept issuing further tool
   calls without ever stopping) surfaces the plan ONLY if at least one tool
   call actually succeeded — a model stuck failing the same invalid input
   every turn never moves the plan off baseline, and that must not be
   reported as "proposed, nothing needs to change."
5. **Tamper-proof audit log** — `agent_trajectories` / `agent_rounds` /
   `agent_usage` are written by the **service role only**; users can read
   their own rows, never write. Every round is logged, including failures.
6. **Plan writes stay RLS-guarded** — `confirm` does **no model call**: it
   re-validates the stored proposal and returns it; the **client** persists it
   through the normal `carryProgress` + `db.set` path under the user's own
   JWT. (A server-side write to `app_state` would be clobbered by the
   client's debounced whole-blob upsert — this is a deliberate deviation from
   the original plan, which assumed typed `plans`/`workouts` tables.)

## Key deviations from the original implementation plan

- **No `plans`/`workouts` tables.** The plan is the `buildPlan()` JSON in
  `app_state.data.rc_plan`; rounds snapshot the full plan JSON instead.
- **App vocabulary**, not generic: session types
  `EASY|TEMPO|INTERVALS|LONG|RACE|WALK|OTHER`, phases
  `BASE|BUILD|PEAK|TAPER|RACE`. "Cross-training" = `WALK`.
- **Baseline waiver**: a user's *existing* plan can violate a rule (aggressive
  short-horizon generator output, user-chosen adjacent hard days). Errors that
  exist identically in the baseline are reported as warnings, so the agent can
  still help — it just can't make the plan worse.
- The server reads the plan/runs from `app_state` (source of truth), not from
  the request body; the client calls `flushNow()` first (`src/coach.js`).
- **A trajectory only closes (`no_valid_adjustment`) when there's nothing to
  fall back on** — round 0 failing (nothing was ever proposed). A failed
  *critique* on an otherwise-open trajectory leaves it `open`: the prior round
  that DID validate is still the one `confirm` would apply, so the user can
  still accept it instead of being dead-ended by one bad follow-up message.
  The response carries an explicit `trajectoryClosed` boolean so the client
  never has to re-derive this rule from `roundIndex`.

## Validator rules (safety > consistency > peak performance)

| Code | Severity | Rule |
| --- | --- | --- |
| `MALFORMED` / `DUPLICATE_ID` / `OUT_OF_WEEK` / `AFTER_RACE` / `SESSION_TOO_LONG` | error | structural soundness (RACE sessions are exempt from the week window — the generator caps plans at 24 weeks) |
| `RAMP_EXCEEDED` | error | weekly volume ≤ max(prev, week-before) × 1.3 + 3 km; waived when the week didn't grow vs the baseline (recovery-week false positive) |
| `HARD_BACK_TO_BACK` | error | no two hard sessions (TEMPO/INTERVALS/LONG) on consecutive days |
| `TAPER_INTERVALS` / `TAPER_TEMPO` / `TAPER_VOLUME` | error | no intervals in the final 14 days, no tempo in the final 7, final two weeks well below peak volume |
| `RACE_ADJACENT` / `SAME_DAY` | warn | surfaced to the model, never blocking |

## Deploy & configuration

```sh
supabase db push                          # migration 20260702120000_coach_agent.sql
supabase functions deploy coach-agent
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

| Env (function secret) | Default | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | required unless `MOCK_LLM=1` |
| `COACH_MODEL` | `claude-sonnet-4-6` | coaching judgment. Upgrading (e.g. `claude-sonnet-5`) is one secret change. |
| `COACH_MODEL_LIGHT` | `claude-haiku-4-5` | reserved for the `pickModel` routing seam (Phase 5) — unused until a classifier routes trivial edits |
| `RATE_LIMIT_PER_DAY` | `20` | model-calling rounds per user per day (confirm is free); enforced via the atomic `increment_agent_usage` SQL function |
| `MOCK_LLM` | unset | `1` → canned responses from `_shared/coach/mock.mjs`, zero Anthropic calls (CI, local dev) |

Prompt caching: one `cache_control` breakpoint on the system block caches the
stable prefix (tool defs + system prompt) across rounds. Token usage is
persisted per round (`agent_rounds.input_tokens/output_tokens`).

## Local development

```sh
supabase start
MOCK_LLM=1 supabase functions serve coach-agent   # or set a dev ANTHROPIC_API_KEY
```

Smoke: `curl -i -X POST http://127.0.0.1:54321/functions/v1/coach-agent -H 'Content-Type: application/json' -d '{"action":"propose","message":"hi"}'`
→ `401` (auth required) proves the function is up; a signed-in client goes
through `src/coach.js`.

## Eval & metrics

- **Golden cases** run in CI with zero API calls, via two complementary
  harnesses over the same `generateProposal` loop:
  - `src/utils/coachGolden.test.js` — free-text situations through the
    keyword-based `MOCK_LLM` scripts (`_shared/coach/mock.mjs`), exercising
    realistic conversational flow.
  - `src/utils/coachAgent.eval.test.js` — exact scripted tool-call sequences
    per situation (`npm run eval` runs just this file), including the two
    tool-execution-error paths (a bad `factor` thrown by `applyToolCall`
    itself, and recovery from one) that the keyword mock doesn't reach.
  Both assert adaptation *properties*, not exact output (knee pain never adds
  intensity; a missed week never "makes up" volume; the validator-failure path
  ends in `no_valid_adjustment`). `npm test` runs both.
- **Live model eval** — `npm run eval:live` (`evals/coach/`, needs
  `ANTHROPIC_API_KEY`; `COACH_EVAL_MOCK=1` for a free plumbing check) replays
  10 realistic scenarios through the real `generateProposal` loop against the
  real API and grades in two tiers: **safety** invariants that fail the run
  (validator passes, done/RACE untouched, volume never up, pain never adds
  intensity) and **quality** metrics that are scored but non-blocking (right
  tool family, graceful refusals, referral language). Writes a JSON report per
  run to `evals/coach/results/` (git-ignored). Run it before changing
  `SYSTEM_PROMPT`, tool descriptions, validator rules, or `COACH_MODEL`
  (`COACH_EVAL_MODEL=...` compares candidates). See `evals/coach/README.md`.
- **The propose/confirm log is the eval dataset**: `agent_rounds.input_context`
  labels what the model saw; `proposed_plan`, `tool_calls`, `outcome` label
  what it did and how it fared.
- **Headline metrics** — query the `agent_metrics` view (service role /
  dashboard): first-proposal acceptance rate, average rounds-to-accept, and
  the abandoned / no_valid_adjustment split.

## Later phases (designed-for, not built)

- **Event-driven triggers** (a logged run deviating from plan → proactive
  proposal): a second entry point that reuses the same turn handler.
- **Staged auto-approve** per tool type (conservative tools first): the
  per-tool logging in `agent_rounds.tool_calls` and the `outcome` column make
  the graduation data available.
- **Haiku routing**: implement a classifier inside `pickModel` — nothing else
  changes.
- **Preview environments / branching** (original Phase 7): enable Supabase
  Branching so each PR gets an isolated instance with migrations + function
  deployed and `MOCK_LLM=1`; keep live-API smoke tests on-demand only.
