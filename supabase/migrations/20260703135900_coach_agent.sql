-- Running Coach — AI coach agent audit log + rate limiting.
--
-- The agent (supabase/functions/coach-agent) proposes ADJUSTMENTS to the
-- existing training plan; the user confirms or critiques. There are NO typed
-- plans/workouts tables on purpose: the plan is the buildPlan() JSON living in
-- app_state.data.rc_plan (the per-user blob), and forking it into rows would
-- create a second source of truth the client's whole-blob debounce-upsert
-- would immediately fight with. Rounds snapshot the full plan JSON instead.
--
-- Trust model:
--   * agent_trajectories / agent_rounds / agent_usage are written by the
--     SERVICE ROLE ONLY (the edge function). Authenticated users get read
--     access to their own trajectories/rounds (history UI, transparency) but
--     no insert/update/delete — the audit log is tamper-proof from the client.
--   * Committing an accepted plan is NOT done here: `confirm` returns the
--     validated plan and the client persists it into app_state through its own
--     JWT, so the existing RLS on app_state keeps applying (defense in depth).

-- ── agent_trajectories ──────────────────────────────────────────────────────
-- One row per propose→critique→…→accept conversation about one adjustment.
create table if not exists public.agent_trajectories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'open'
    check (status in ('open','accepted','abandoned','no_valid_adjustment')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists agent_trajectories_user_idx
  on public.agent_trajectories (user_id, status);

-- ── agent_rounds ────────────────────────────────────────────────────────────
-- One row per model-calling round, including failed ones. This IS the eval
-- dataset: input_context labels what the model saw, proposed_plan is the full
-- validated snapshot it produced, tool_calls the actions it chose.
create table if not exists public.agent_rounds (
  id             uuid primary key default gen_random_uuid(),
  trajectory_id  uuid not null references public.agent_trajectories(id) on delete cascade,
  round_index    integer not null,
  user_feedback  text,                 -- null on round 0; the critique text after
  tool_calls     jsonb not null default '[]'::jsonb,
  rationale      text,
  proposed_plan  jsonb not null,       -- full plan snapshot for this round
  input_context  jsonb not null,       -- baseline plan + run window + report (the label)
  model          text not null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  outcome        text not null default 'proposed'
    check (outcome in ('proposed','accepted','superseded','invalid')),
  created_at     timestamptz not null default now(),
  unique (trajectory_id, round_index)
);

-- ── agent_usage ─────────────────────────────────────────────────────────────
-- Per-user daily counter of model-calling rounds (propose/critique; confirm is
-- free). Protects the API budget — enforced in the edge function.
create table if not exists public.agent_usage (
  user_id  uuid not null references auth.users(id) on delete cascade,
  day      date not null,
  count    integer not null default 0,
  primary key (user_id, day)
);

-- Atomic increment used by the edge function (service role), so two concurrent
-- requests can't both read count=N and write N+1. Returns the new count.
create or replace function public.increment_agent_usage(p_user_id uuid, p_day date)
returns integer language sql security definer set search_path = public as $$
  insert into public.agent_usage (user_id, day, count)
  values (p_user_id, p_day, 1)
  on conflict (user_id, day) do update set count = agent_usage.count + 1
  returning count;
$$;
-- Service-role only: revoke the default PUBLIC execute so a client can't burn
-- quota, then grant back to the service role explicitly.
revoke execute on function public.increment_agent_usage(uuid, date) from anon, authenticated, public;
grant execute on function public.increment_agent_usage(uuid, date) to service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.agent_trajectories enable row level security;
alter table public.agent_rounds       enable row level security;
alter table public.agent_usage        enable row level security;

-- Read-own for the history UI; NO write grants — writes are service-role only.
grant select on public.agent_trajectories, public.agent_rounds to authenticated;
grant all on public.agent_trajectories, public.agent_rounds, public.agent_usage to service_role;

drop policy if exists "agent_trajectories read own" on public.agent_trajectories;
create policy "agent_trajectories read own"
  on public.agent_trajectories for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "agent_rounds read own" on public.agent_rounds;
create policy "agent_rounds read own"
  on public.agent_rounds for select to authenticated
  using (exists (
    select 1 from public.agent_trajectories t
    where t.id = trajectory_id and t.user_id = auth.uid()
  ));

-- agent_usage: no client policies at all — service role only.

-- ── Headline metrics ────────────────────────────────────────────────────────
-- First-proposal acceptance rate + rounds-to-accept, straight off the log.
-- security_invoker: readable only by roles that can read the tables (service
-- role / dashboard) — this is a maintainer view, not a client one.
create or replace view public.agent_metrics
  with (security_invoker = true) as
select
  count(*) filter (where status = 'accepted')                          as accepted,
  count(*) filter (where status = 'abandoned')                         as abandoned,
  count(*) filter (where status = 'no_valid_adjustment')               as no_valid_adjustment,
  count(*)                                                             as total,
  avg(r.rounds) filter (where status = 'accepted')                     as avg_rounds_to_accept,
  count(*) filter (where status = 'accepted' and r.rounds = 1)::float
    / nullif(count(*) filter (where status = 'accepted'), 0)           as first_proposal_acceptance_rate
from public.agent_trajectories t
left join lateral (
  select count(*) as rounds from public.agent_rounds where trajectory_id = t.id
) r on true;
