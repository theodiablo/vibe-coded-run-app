-- Decouple "uploaded to the store" from "announced to users". The release
-- workflow used to write latest_version(_ios) right after a store upload, but
-- an upload is not a rollout: Play/App Store review means the build isn't
-- installable yet, so outdated clients saw an "update available" nudge pointing
-- at a version the store didn't serve. The release now STAGES what each store
-- received in these pending columns; the manual "Publish app version" workflow
-- (publish-version.yml) promotes pending -> latest once the store has actually
-- published the build. NULL means nothing is awaiting publication.
alter table public.app_config
  add column if not exists pending_version     text,
  add column if not exists pending_version_ios text;
