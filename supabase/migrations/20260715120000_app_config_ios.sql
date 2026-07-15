-- Per-platform version gate. The unified v* release ships Android and iOS from
-- the same tag, but each store's rollout (and each platform job's success) is
-- independent, so each platform gets its own pair of columns; release CI writes
-- only the column for the platform it actually uploaded. The original
-- min_supported_version / latest_version columns stay Android's — renaming them
-- would break every installed Android client's select.
alter table public.app_config
  add column if not exists min_supported_version_ios text not null default '0.0.0',
  add column if not exists latest_version_ios        text not null default '0.0.0';
