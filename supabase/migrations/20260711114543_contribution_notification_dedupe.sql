-- Track best-effort maintainer notification sends so notify-contribution cannot
-- be replayed to spam SES for the same contributed row.

create table if not exists public.contribution_notifications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  reference   text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (kind, reference)
);

alter table public.contribution_notifications enable row level security;

-- Edge functions write with the service role after validating the source row.
-- There is intentionally no client grant or RLS policy.
grant all on public.contribution_notifications to service_role;
