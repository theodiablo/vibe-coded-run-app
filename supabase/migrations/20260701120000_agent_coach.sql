-- Running Coach — AI coach agent: tamper-proof audit log + per-user rate limiter.
--
-- The propose-and-confirm coach agent runs server-side (the `coach-agent` edge
-- function). These three tables are the trajectory record (also the eval dataset)
-- and the daily API-budget counter. They are written ONLY by the service role
-- (the edge function bypasses RLS). Clients get NO write path — the user steers
-- the agent but cannot rewrite the record of what happened. A user may READ their
-- own trajectories/rounds (for a future history UI) and nothing on agent_usage.
--
-- NOTE: the plan the agent edits is the user's `app_state.data.rc_plan` JSON blob
-- (there are no relational plans/workouts tables). `proposed_plan` stores the full
-- validated plan snapshot per round; there is deliberately no plan_id FK.

create table if not exists public.agent_trajectories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'open'
    check (status in ('open','accepted','abandoned','no_valid_adjustment')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists agent_trajectories_user_idx
  on public.agent_trajectories(user_id, created_at desc);

create table if not exists public.agent_rounds (
  id             uuid primary key default gen_random_uuid(),
  trajectory_id  uuid not null references public.agent_trajectories(id) on delete cascade,
  round_index    integer not null,
  user_feedback  text,                          -- null on round 0; the critique after
  tool_calls     jsonb not null default '[]'::jsonb,
  rationale      text,
  proposed_plan  jsonb not null,                -- full validated rc_plan snapshot
  input_context  jsonb not null,                -- plan + run-history window + report (the label)
  model          text not null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  outcome        text not null default 'proposed'
    check (outcome in ('proposed','accepted','superseded')),
  created_at     timestamptz not null default now(),
  unique (trajectory_id, round_index)
);
create index if not exists agent_rounds_trajectory_idx
  on public.agent_rounds(trajectory_id);

-- Per-user daily rate-limit counter (protects the Anthropic API budget).
create table if not exists public.agent_usage (
  user_id  uuid not null references auth.users(id) on delete cascade,
  day      date not null,
  count    integer not null default 0,
  primary key (user_id, day)
);

alter table public.agent_trajectories enable row level security;
alter table public.agent_rounds        enable row level security;
alter table public.agent_usage         enable row level security;

-- Read-own only. No insert/update/delete privileges are granted to client roles,
-- so only the service role can write these tables (it bypasses RLS entirely).
grant select on public.agent_trajectories to authenticated;
grant select on public.agent_rounds        to authenticated;

drop policy if exists "agent_trajectories read own" on public.agent_trajectories;
create policy "agent_trajectories read own"
  on public.agent_trajectories for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "agent_rounds read own" on public.agent_rounds;
create policy "agent_rounds read own"
  on public.agent_rounds for select to authenticated
  using (exists (
    select 1 from public.agent_trajectories t
    where t.id = agent_rounds.trajectory_id and t.user_id = auth.uid()
  ));

-- agent_usage: no grants, no policies. RLS is on with nothing permitted, so
-- authenticated/anon see zero rows and cannot write — service-role only.
