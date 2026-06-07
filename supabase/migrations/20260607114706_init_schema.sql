-- Running Coach — initial schema
-- Mirrors the auth + persistence model used in LOYERS_BXL (profiles + a single
-- jsonb app_state blob), adapted to be PER-USER instead of a single shared row.
-- The anon/publishable key is public; Row-Level Security below is the real
-- security boundary.

-- ── profiles ───────────────────────────────────────────────────────
-- One row per auth user, auto-created by a trigger on sign-up.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table public.profiles enable row level security;

drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own"
  on public.profiles for select to authenticated using (auth.uid() = id);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own"
  on public.profiles for insert to authenticated with check (auth.uid() = id);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own"
  on public.profiles for update to authenticated using (auth.uid() = id);

-- Auto-create a profile when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── app_state ──────────────────────────────────────────────────────
-- One jsonb blob per user, holding the running-coach state that currently
-- lives in localStorage (rc_runs, rc_plan, rc_settings, rc_coach_msgs).
-- NOTE: the Anthropic API key (rc_api_key) is intentionally NOT stored here —
-- keep it client-side, or move it behind an Edge Function later.
create table if not exists public.app_state (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "app_state read own" on public.app_state;
create policy "app_state read own"
  on public.app_state for select to authenticated using (auth.uid() = user_id);

drop policy if exists "app_state insert own" on public.app_state;
create policy "app_state insert own"
  on public.app_state for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "app_state update own" on public.app_state;
create policy "app_state update own"
  on public.app_state for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
