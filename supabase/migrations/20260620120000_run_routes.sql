-- Running Coach — GPS route traces for live-tracked runs.
-- One row per tracked run, holding the (simplified) polyline + computed stats.
-- Kept OUT of the app_state jsonb blob on purpose: a trace is heavy and the blob
-- is re-upserted whole on every change, so storing traces here keeps the blob
-- small. A run in rc_runs holds only a summary + `routeId` reference.
-- RLS mirrors app_state: the publishable key is public, these policies are the
-- real boundary.

create table if not exists public.run_routes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  points      jsonb not null,                       -- simplified [[lat,lng,t,alt],...], null = gap
  stats       jsonb not null default '{}'::jsonb,   -- {km, durationSec, elevation, avgPace}
  created_at  timestamptz not null default now()
);

create index if not exists run_routes_user_id_idx on public.run_routes (user_id);

alter table public.run_routes enable row level security;

drop policy if exists "run_routes read own" on public.run_routes;
create policy "run_routes read own"
  on public.run_routes for select to authenticated using (auth.uid() = user_id);

drop policy if exists "run_routes insert own" on public.run_routes;
create policy "run_routes insert own"
  on public.run_routes for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "run_routes update own" on public.run_routes;
create policy "run_routes update own"
  on public.run_routes for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "run_routes delete own" on public.run_routes;
create policy "run_routes delete own"
  on public.run_routes for delete to authenticated using (auth.uid() = user_id);
