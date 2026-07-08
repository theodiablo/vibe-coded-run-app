-- Running Coach — app version gate. A single config row the client reads on
-- launch to decide whether to softly nudge (latest_version) or hard-block
-- (min_supported_version) an update. The strings are not sensitive, so the row is
-- world-readable; release CI writes it through Supabase Management API SQL, so
-- there are NO insert/update/delete policies for client roles.

create table if not exists public.app_config (
  id                     int primary key default 1,
  min_supported_version  text not null default '0.0.0',  -- below this → forced update
  latest_version         text not null default '0.0.0',  -- below this → soft "update available"
  updated_at             timestamptz not null default now(),
  constraint app_config_singleton check (id = 1)         -- exactly one row
);

-- Seed the singleton row (idempotent).
insert into public.app_config (id) values (1) on conflict (id) do nothing;

alter table public.app_config enable row level security;

-- Readable by everyone, including signed-out clients (the version check runs
-- before login). Base SELECT privilege + a permissive SELECT policy; no write
-- privileges, so maintainer/CI writes go through privileged SQL, not client roles.
grant select on public.app_config to anon, authenticated;

drop policy if exists "app_config readable by all" on public.app_config;
create policy "app_config readable by all"
  on public.app_config for select to anon, authenticated using (true);
