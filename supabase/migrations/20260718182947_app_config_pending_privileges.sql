-- The pending_* staging columns hold a version a store has received but not
-- yet published, and app_config's table-scope SELECT grant (see
-- 20260623120000_app_config.sql) made them world-readable — a pre-publication
-- leak the old direct-to-latest_version flow never had. Narrow the client
-- grant to column level: everything except the pending pair. Safe for shipped
-- clients because the app has only ever selected explicit columns
-- (src/App.tsx), never *; CI and maintainer writes go through privileged
-- connections that bypass these grants. If app_config ever gains another
-- client-visible column, it must be added to this grant list.
revoke select on table public.app_config from anon, authenticated;
grant select (id, min_supported_version, latest_version,
              min_supported_version_ios, latest_version_ios, updated_at)
  on public.app_config to anon, authenticated;
