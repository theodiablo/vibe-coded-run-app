-- Running Coach — user "this answer is wrong" feedback on the AI coach.
--
-- Lets a user flag a specific coach response (identified by the trajectory +
-- round it came from) and explain what it got wrong, so the maintainer has a
-- signal for real-world turns that misfired. Mirrors the race_reports pattern
-- in 20260629120000_races_catalogue.sql: INSERT-only from the client, no
-- client SELECT — the maintainer reviews via the Supabase SQL editor
-- (see docs/coach-agent.md for the join query against agent_rounds).

create table if not exists public.coach_feedback (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  trajectory_id  uuid not null,
  round_index    integer not null,
  correction     text not null,
  created_at     timestamptz not null default now(),
  foreign key (trajectory_id, round_index)
    references public.agent_rounds (trajectory_id, round_index) on delete cascade
);
create index if not exists coach_feedback_round_idx
  on public.coach_feedback (trajectory_id, round_index);

alter table public.coach_feedback enable row level security;

-- INSERT only: a grant without a policy still 403s, and vice-versa — both are
-- required. No select grant/policy, so the client can never read the table.
grant insert on public.coach_feedback to authenticated;
grant all    on public.coach_feedback to service_role;

drop policy if exists "coach_feedback insert own" on public.coach_feedback;
create policy "coach_feedback insert own"
  on public.coach_feedback for insert to authenticated
  with check (auth.uid() = user_id);
