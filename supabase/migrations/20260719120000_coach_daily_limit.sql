-- Per-user coach daily-limit override (premium seam).
--
-- The coach's free allowance is a per-day round budget enforced in the
-- coach-agent edge function (RATE_LIMIT_PER_DAY, default 5). This nullable
-- column lets a future premium tier raise the budget for a single user without
-- any new entitlement tables: NULL means "use the env default", a positive
-- integer overrides it. Only the service role / dashboard ever writes it — see
-- the grant narrowing below.
alter table public.profiles
  add column if not exists coach_daily_limit integer
    check (coach_daily_limit is null or coach_daily_limit > 0);

-- Security: 20260607165159 granted table-level insert/update on profiles to
-- `authenticated`, and "insert own"/"update own" RLS policies exist — so
-- without narrowing, a user could set their own coach_daily_limit and mint
-- unlimited coach requests. No client or function code writes profiles as the
-- user (the row is created by the handle_new_user SECURITY DEFINER trigger and
-- otherwise only read), so restrict the authenticated grants to the columns
-- that legitimately need them. coach_daily_limit is deliberately excluded, so
-- it stays service-role-only writable while RLS still scopes reads to the owner.
revoke insert, update on public.profiles from authenticated;
grant insert (id, email, last_seen_at) on public.profiles to authenticated;
grant update (email, last_seen_at) on public.profiles to authenticated;
