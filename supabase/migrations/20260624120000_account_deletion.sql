-- Allow a signed-in user to permanently delete their own account.
-- Deleting from auth.users cascades to profiles, app_state, and run_routes
-- via the ON DELETE CASCADE FK constraints set up in the init migration.
-- SECURITY DEFINER so the function runs as its owner (postgres) which has
-- the privilege to write to the auth schema; auth.uid() still identifies
-- the calling user so no one can delete another account.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
