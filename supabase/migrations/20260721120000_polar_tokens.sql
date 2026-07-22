-- Running Coach — Polar AccessLink OAuth tokens (server-side only).
--
-- Stores a user's long-lived Polar access token + their AccessLink user id, so
-- the `polar-import` edge function can pull that user's finished exercises
-- (route + HR series + summary) from Polar's cloud for phone-free runs.
--
-- The access token is a SECRET credential, so this table is service-role-only,
-- mirroring the coach agent's trust boundary: RLS is ON with NO grants or
-- policies for `authenticated`, so a signed-in client can never SELECT, INSERT,
-- UPDATE or DELETE it. Only the edge function (service_role, which bypasses RLS)
-- ever touches the token — it never reaches the SPA bundle.

create table if not exists public.polar_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  polar_user_id text not null,
  access_token  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.polar_tokens enable row level security;

-- Service role only. Deliberately no grants/policies for `authenticated`:
-- RLS-on + zero authenticated grants means every client verb 403s, while
-- service_role bypasses RLS. The token stays entirely server-side.
grant all on public.polar_tokens to service_role;
