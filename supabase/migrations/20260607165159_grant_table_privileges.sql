-- Grant table privileges to the authenticated role.
--
-- The init migration enabled RLS and created policies on profiles/app_state,
-- but never granted base table privileges to `authenticated`. RLS policies
-- filter rows; they do NOT grant access to the table itself, so every client
-- read/write returned `42501 permission denied for table ...` (HTTP 403) and
-- nothing was ever persisted. These grants are the missing half — RLS still
-- scopes every row to auth.uid().

grant select, insert, update, delete on public.app_state to authenticated;
grant select, insert, update, delete on public.profiles  to authenticated;
