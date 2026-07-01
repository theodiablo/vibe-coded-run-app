# coach-agent

The propose-and-confirm training-plan agent (server side of the AI coach). The
Anthropic key, the validator, the tool implementations, and the audit log all
live here — the client only sends a message and renders the returned proposal.

## Shape

- `index.ts` — HTTP handler: JWT verify, rate limit, the three actions
  (`propose` / `critique` / `confirm`) and the internal validate-and-retry loop.
- `llm.ts` — the Anthropic call, the 6 tool schemas, the system prompt, and the
  `pickModel` routing seam. `MOCK_LLM=1` returns deterministic fixtures.
- The validator and tool transforms are the **same** pure modules the React app
  uses, imported from `../../../src/utils/planValidate.js` and `planTools.js`
  (one validator, two callers). ⚠️ **Verify first on deploy** that the bundler
  includes these cross-directory imports (`supabase functions serve coach-agent`
  and hit it once).

## The plan lives in the blob, not a table

The agent reads and writes the user's `app_state.data.rc_plan` JSON (there are no
relational plans/workouts tables). `confirm` commits through the **user** client
so RLS applies, and carries progress (done/skipped/runId) by session id.
`agent_trajectories` / `agent_rounds` / `agent_usage` are written with the
**service** role (see the migration) — the user can never write them.

## Local run

```sh
# deterministic, no network:
MOCK_LLM=1 supabase functions serve coach-agent

# smoke:
curl -sS -X POST http://localhost:54321/functions/v1/coach-agent \
  -H "Authorization: Bearer <a-user-jwt>" -H "content-type: application/json" \
  -d '{"action":"propose","message":"my knee hurts"}'

# force the validator-exhaustion path in mock mode:
#   add header  -H "x-mock-scenario: invalid"   → status "no_valid_adjustment"
```

## Deploy

```sh
supabase functions deploy coach-agent
supabase secrets set ANTHROPIC_API_KEY=...        # RATE_LIMIT_PER_DAY optional
```

Deploy mirrors `notify-contribution`; the web S3/CloudFront deploy is untouched.
CI runs with `MOCK_LLM=1` (no live Anthropic calls). Supabase Branching is
deferred (it requires the Pro plan) — see the plan file.
