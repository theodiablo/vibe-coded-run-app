-- Harden SECURITY DEFINER functions flagged by the Supabase database linter
-- (lints 0028 / 0029): a SECURITY DEFINER function living in the API-exposed
-- `public` schema is callable by the `anon` and `authenticated` roles over
-- PostgREST at `/rest/v1/rpc/<fn>`. Neither function here is a public RPC:
--
--   * handle_new_user() only ever runs as the `on_auth_user_created` trigger.
--     Triggers execute with the privileges of the function owner, so the
--     trigger keeps working after EXECUTE is revoked from the API roles.
--   * rls_auto_enable() was created outside these migrations and is likewise
--     not meant to be called directly.
--
-- Postgres grants EXECUTE to PUBLIC by default on every new function — that
-- implicit grant (inherited by anon/authenticated) is exactly what the linter
-- flags. Revoke it.

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- rls_auto_enable() is not defined in these migrations, so guard the revoke on
-- its existence to keep this migration safe to run on any environment.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
      and p.pronargs = 0
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end$$;
