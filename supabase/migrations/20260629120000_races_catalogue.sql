-- Running Coach — shared race catalogue (Phase 2 of gamification/races).
--
-- A "race" is the recurring event; a "race_edition" is one dated running of it
-- (the thing a user wishlists / targets / completes). Phase 1 shipped this as a
-- read-only bundle in the client (src/data/races.js); Phase 2 moves it to these
-- shared tables so the catalogue is GLOBAL and any signed-in user can contribute.
--
-- Trust model: curated seed rows have `created_by = null` + `verified = true`.
-- User-contributed rows are `verified = false` and tagged "unverified" in the UI;
-- only the service role (the maintainer, via the dashboard) can flip `verified`.
-- RLS mirrors the existing tables: world-readable like app_config, owner-scoped
-- writes like run_routes — but with a hard guard that a contributor can NEVER
-- set `verified = true` on their own rows (see the `verified = false` with-check).

-- ── races ───────────────────────────────────────────────────────────────────
create table if not exists public.races (
  slug        text primary key,
  name        text not null,
  city        text,
  country     text,
  lat         double precision,
  lng         double precision,
  distances   jsonb not null default '[]'::jsonb,
  url         text,
  verified    boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists races_country_idx on public.races (country);

-- ── race_editions ─────────────────────────────────────────────────────────--
-- id is `slug-YYYY-MM-DD` for the seed + typical single-distance editions, so
-- Phase 1 participation ids (editionId = slug-date) still resolve. addEdition
-- only suffixes the distance when slug-date is already taken.
create table if not exists public.race_editions (
  id           text primary key,
  race_slug    text not null references public.races(slug) on delete cascade,
  date         date not null,
  distance_km  double precision not null,
  elevation    integer not null default 0,
  verified     boolean not null default false,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (race_slug, date, distance_km)
);
create index if not exists race_editions_race_slug_idx on public.race_editions (race_slug);

-- ── race_reports (moderation) ────────────────────────────────────────────────
-- One row per "report this race" submission. Maintainer reads via the service
-- role / dashboard — there is deliberately NO client SELECT policy, so the
-- access module must insert WITHOUT a returning .select().
create table if not exists public.race_reports (
  id           uuid primary key default gen_random_uuid(),
  race_slug    text,
  edition_id   text,
  reason       text not null,
  note         text,
  reporter_id  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────--
alter table public.races         enable row level security;
alter table public.race_editions enable row level security;
alter table public.race_reports  enable row level security;

-- Base privileges. RLS policies filter rows but do NOT grant table access — both
-- are required (a grant without a policy still 403s, and vice-versa). The
-- catalogue is world-readable (anon + authenticated); writes are authenticated.
grant select on public.races, public.race_editions to anon, authenticated;
grant insert, update, delete on public.races, public.race_editions to authenticated;
grant insert on public.race_reports to authenticated;

-- races: readable by all, contributors own their rows but can't self-verify.
drop policy if exists "races readable by all" on public.races;
create policy "races readable by all"
  on public.races for select to anon, authenticated using (true);

drop policy if exists "races insert own unverified" on public.races;
create policy "races insert own unverified"
  on public.races for insert to authenticated
  with check (auth.uid() = created_by and verified = false);

drop policy if exists "races update own unverified" on public.races;
create policy "races update own unverified"
  on public.races for update to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by and verified = false);

drop policy if exists "races delete own" on public.races;
create policy "races delete own"
  on public.races for delete to authenticated using (auth.uid() = created_by);

-- race_editions: same pattern.
drop policy if exists "race_editions readable by all" on public.race_editions;
create policy "race_editions readable by all"
  on public.race_editions for select to anon, authenticated using (true);

drop policy if exists "race_editions insert own unverified" on public.race_editions;
create policy "race_editions insert own unverified"
  on public.race_editions for insert to authenticated
  with check (auth.uid() = created_by and verified = false);

drop policy if exists "race_editions update own unverified" on public.race_editions;
create policy "race_editions update own unverified"
  on public.race_editions for update to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by and verified = false);

drop policy if exists "race_editions delete own" on public.race_editions;
create policy "race_editions delete own"
  on public.race_editions for delete to authenticated using (auth.uid() = created_by);

-- race_reports: anyone signed-in may file a report (can't spoof the reporter);
-- no SELECT policy, so clients can never read the reports table.
drop policy if exists "race_reports insert own" on public.race_reports;
create policy "race_reports insert own"
  on public.race_reports for insert to authenticated
  with check (auth.uid() = reporter_id);

-- ── Curated seed (migrated from the old src/data/races.js bundle) ─────────────
-- created_by null + verified true marks these as the trusted set. Idempotent.
insert into public.races (slug, name, city, country, lat, lng, distances, url, verified) values
  ('berlin-marathon',         'BMW Berlin Marathon',        'Berlin',        'DE', 52.5163,  13.3777,  '[42.2]', 'https://www.bmw-berlin-marathon.com/',          true),
  ('london-marathon',         'TCS London Marathon',        'London',        'GB', 51.5074,  -0.1278,  '[42.2]', 'https://www.tcslondonmarathon.com/',            true),
  ('chicago-marathon',        'Chicago Marathon',           'Chicago',       'US', 41.8757,  -87.6244, '[42.2]', 'https://www.chicagomarathon.com/',              true),
  ('nyc-marathon',            'TCS New York City Marathon', 'New York',      'US', 40.7029,  -74.0170, '[42.2]', 'https://www.nyrr.org/tcsnycmarathon',           true),
  ('tokyo-marathon',          'Tokyo Marathon',             'Tokyo',         'JP', 35.6895,  139.6917, '[42.2]', 'https://www.marathon.tokyo/en/',                true),
  ('boston-marathon',         'Boston Marathon',            'Boston',        'US', 42.3601,  -71.0589, '[42.2]', 'https://www.baa.org/',                          true),
  ('marathon-de-paris',       'Marathon de Paris',          'Paris',         'FR', 48.8566,  2.3522,   '[42.2]', 'https://www.schneiderelectricparismarathon.com/', true),
  ('20km-de-paris',           '20 km de Paris',             'Paris',         'FR', 48.8584,  2.2945,   '[20]',   'https://www.20kmparis.com/',                    true),
  ('marseille-cassis',        'Marseille-Cassis',           'Marseille',     'FR', 43.2965,  5.3698,   '[20]',   'https://www.marseille-cassis.com/',             true),
  ('marvejols-mende',         'Marvejols-Mende',            'Mende',         'FR', 44.5180,  3.4996,   '[22.4]', 'https://www.marvejols-mende.fr/',               true),
  ('marathon-du-medoc',       'Marathon du Médoc',          'Pauillac',      'FR', 45.1985,  -0.7459,  '[42.2]', 'https://www.marathondumedoc.com/',              true),
  ('utmb',                    'UTMB Mont-Blanc',            'Chamonix',      'FR', 45.9237,  6.8694,   '[171]',  'https://utmbmontblanc.com/',                    true),
  ('behobia-san-sebastian',   'Behobia-San Sebastián',      'San Sebastián', 'ES', 43.3183,  -1.9812,  '[20]',   'https://www.behobia-sansebastian.com/',         true),
  ('valencia-marathon',       'Valencia Marathon',          'Valencia',      'ES', 39.4699,  -0.3763,  '[42.2]', 'https://www.valenciaciudaddelrunning.com/',     true),
  ('barcelona-marathon',      'Barcelona Marathon',         'Barcelona',     'ES', 41.3851,  2.1734,   '[42.2]', 'https://www.zurichmaratonbarcelona.es/',        true),
  ('sevilla-marathon',        'Zurich Maratón de Sevilla',  'Sevilla',       'ES', 37.3891,  -5.9845,  '[42.2]', 'https://www.zurichmaratonsevilla.es/',          true),
  ('san-silvestre-vallecana', 'San Silvestre Vallecana',    'Madrid',        'ES', 40.4168,  -3.7038,  '[10]',   'https://www.sansilvestrevallecana.com/',        true),
  ('great-north-run',         'Great North Run',            'Newcastle',     'GB', 54.9783,  -1.6178,  '[21.1]', 'https://www.greatrun.org/great-north-run/',     true),
  ('cardiff-half',            'Cardiff Half Marathon',      'Cardiff',       'GB', 51.4816,  -3.1791,  '[21.1]', 'https://www.cardiffhalfmarathon.co.uk/',        true),
  ('brighton-marathon',       'Brighton Marathon',          'Brighton',      'GB', 50.8225,  -0.1372,  '[42.2]', 'https://www.brightonmarathonweekend.co.uk/',    true),
  ('manchester-marathon',     'Manchester Marathon',        'Manchester',    'GB', 53.4808,  -2.2426,  '[42.2]', 'https://www.manchestermarathon.co.uk/',         true),
  ('edinburgh-marathon',      'Edinburgh Marathon',         'Edinburgh',     'GB', 55.9533,  -3.1883,  '[42.2]', 'https://www.edinburghmarathon.com/',            true)
on conflict (slug) do nothing;

insert into public.race_editions (id, race_slug, date, distance_km, elevation, verified) values
  ('berlin-marathon-2026-09-27',         'berlin-marathon',         '2026-09-27', 42.2, 60,    true),
  ('london-marathon-2027-04-25',         'london-marathon',         '2027-04-25', 42.2, 110,   true),
  ('chicago-marathon-2026-10-11',        'chicago-marathon',        '2026-10-11', 42.2, 30,    true),
  ('nyc-marathon-2026-11-01',            'nyc-marathon',            '2026-11-01', 42.2, 250,   true),
  ('tokyo-marathon-2027-03-07',          'tokyo-marathon',          '2027-03-07', 42.2, 90,    true),
  ('boston-marathon-2027-04-19',         'boston-marathon',         '2027-04-19', 42.2, 250,   true),
  ('marathon-de-paris-2027-04-11',       'marathon-de-paris',       '2027-04-11', 42.2, 120,   true),
  ('20km-de-paris-2026-10-11',           '20km-de-paris',           '2026-10-11', 20,   90,    true),
  ('marseille-cassis-2026-10-25',        'marseille-cassis',        '2026-10-25', 20,   320,   true),
  ('marvejols-mende-2026-07-19',         'marvejols-mende',         '2026-07-19', 22.4, 600,   true),
  ('marathon-du-medoc-2026-09-12',       'marathon-du-medoc',       '2026-09-12', 42.2, 80,    true),
  ('utmb-2026-08-28',                    'utmb',                    '2026-08-28', 171,  10000, true),
  ('behobia-san-sebastian-2026-11-08',   'behobia-san-sebastian',   '2026-11-08', 20,   200,   true),
  ('valencia-marathon-2026-12-06',       'valencia-marathon',       '2026-12-06', 42.2, 10,    true),
  ('barcelona-marathon-2027-03-14',      'barcelona-marathon',      '2027-03-14', 42.2, 120,   true),
  ('sevilla-marathon-2027-02-21',        'sevilla-marathon',        '2027-02-21', 42.2, 20,    true),
  ('san-silvestre-vallecana-2026-12-31', 'san-silvestre-vallecana', '2026-12-31', 10,   90,    true),
  ('great-north-run-2026-09-13',         'great-north-run',         '2026-09-13', 21.1, 130,   true),
  ('cardiff-half-2026-10-04',            'cardiff-half',            '2026-10-04', 21.1, 50,    true),
  ('brighton-marathon-2027-04-11',       'brighton-marathon',       '2027-04-11', 42.2, 90,    true),
  ('manchester-marathon-2027-04-18',     'manchester-marathon',     '2027-04-18', 42.2, 40,    true),
  ('edinburgh-marathon-2027-05-30',      'edinburgh-marathon',      '2027-05-30', 42.2, 60,    true)
on conflict (id) do nothing;
