-- 032_crm_leads.sql
-- CRM-1 (2026-10-10). Owner decisions 2026-10-10 (written OK from work received):
--   the company CRM (LeadGen = white-labelled vtiger 8) is pulled READ-ONLY into
--   three tables. This replaces Stage 12a's "ref + status only" rule with the
--   field list below (Brief Stage 12c, AGENTS "CRM data").
--
--   crm_leads       one row per CRM lead (about 20,651 at 2026-10-10). Holds NO
--                   name, phone, street, house number, note or best-time-to-call.
--                   The street and house number are used once, by the matcher,
--                   to find the door, and are never stored.
--   crm_status_map  CRM status text -> app vocabulary. Data, not code (12a rule 2).
--   crm_sync_runs   one row per backfill or daily sync run; unmatched is
--                   reported here, never guessed (12a rule 3).
--
--   Read: admin and office only (office owns CRM sync review, A29).
--   Write: nobody through the API. Only the server (service role) writes,
--   from scripts/crm-backfill.ts and the daily cron route.
--   leads.crm_ref (003) holds crm_leads.crm_id for app leads matched by
--   door + date. No foreign key: the office may type a ref before the sync
--   has pulled that lead.

-- ---------------------------------------------------------------- status map
create table public.crm_status_map (
  crm_value  text primary key,
  status     text not null
               check (status in ('sale','pm','blowout','utc','re_app',
                                 'confirmed','pending')),
  note       text
);

comment on table public.crm_status_map is
  'CRM-1. CRM Lead Status text -> app status. A CRM value missing here is '
  'stored with status null and counted in crm_sync_runs.unknown_statuses. '
  '"confirmed" exists only on crm_leads (owner 2026-10-10, option A).';

insert into public.crm_status_map (crm_value, status, note) values
  ('Sold',        'sale',      null),
  ('Pitch&Miss',  'pm',        null),
  ('Blowout',     'blowout',   null),
  ('UTC',         'utc',       null),
  ('Re-App',      're_app',    'non-terminal'),
  ('Booked',      'confirmed', 'booked, not yet pitched (office term: Confirmed)'),
  ('Uncontacted', 'pending',   null);

-- ---------------------------------------------------------------- leads
create table public.crm_leads (
  crm_id               text primary key,          -- vtiger record id, e.g. '10x12345'
  lead_no              text unique,               -- CRM "Lead No."
  status_raw           text,                      -- CRM text as sent; null = blank in the CRM
  status               text
                         check (status in ('sale','pm','blowout','utc','re_app',
                                           'confirmed','pending')),
                                                  -- null = "No outcome" (blank) or unmapped
  crm_created_at       timestamptz not null,
  crm_modified_at      timestamptz not null,      -- sync cursor
  appointment_at       timestamptz,
  branch               text not null,
  sale_amount          numeric(12,2) check (sale_amount is null or sale_amount > 0),
  postcode             text,                      -- normalised 'BS7 8AB'; null if blank or unrecognisable
  postcode_sector      text,                      -- 'BS7 8'; area-level grouping for Insights and the heat map
  uprn                 bigint references public.properties(uprn),
  location             geometry(Point,4326),
  match_tier           text not null
                         check (match_tier in ('exact','snapped','interpolated',
                                               'street_nearest','outside_area',
                                               'unmatched')),
  canvasser_first_name text,                      -- first word of the CRM free-text canvasser, tidied
  first_synced_at      timestamptz not null default now(),
  synced_at            timestamptz not null default now(),
  -- A door (UPRN) only for the two tiers that land on a real door.
  constraint crm_leads_uprn_tier_chk
    check ((uprn is not null) = (match_tier in ('exact','snapped'))),
  -- Every placed tier has a point; outside_area and unmatched have none.
  constraint crm_leads_location_tier_chk
    check ((location is not null) = (match_tier in ('exact','snapped','interpolated','street_nearest'))),
  constraint crm_leads_status_raw_chk
    check (status is null or status_raw is not null)
);

comment on table public.crm_leads is
  'CRM-1. Read-only copy of CRM leads, property and area level only. Never '
  'stores names, phones, street text, house numbers or notes. Written only by '
  'the service role (backfill script + daily sync).';
comment on column public.crm_leads.match_tier is
  'exact: postcode + house number found in property_addresses. snapped: '
  'interpolated point snapped to an unlabelled UPRN on the same street. '
  'interpolated / street_nearest: a point only, no door. outside_area: postcode '
  'outside the loaded map area. unmatched: inside the area but not placed.';

create index crm_leads_uprn_idx     on public.crm_leads (uprn) where uprn is not null;
create index crm_leads_created_idx  on public.crm_leads (crm_created_at);
create index crm_leads_modified_idx on public.crm_leads (crm_modified_at);
create index crm_leads_sector_idx   on public.crm_leads (postcode_sector);
create index crm_leads_status_idx   on public.crm_leads (status);
create index crm_leads_location_gix on public.crm_leads using gist (location);

-- ---------------------------------------------------------------- sync runs
create table public.crm_sync_runs (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('backfill','daily')),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  modified_since     timestamptz,                -- cursor this run started from (null = everything)
  max_modified_seen  timestamptz,                -- next run's cursor, set only on success
  rows_seen          int,
  rows_inserted      int,
  rows_updated       int,
  rows_unchanged     int,
  unknown_statuses   jsonb,                      -- {"CRM text": count} for values not in crm_status_map
  match_counts       jsonb,                      -- {"exact": n, "snapped": n, ...}
  app_leads_linked   int,                        -- leads.crm_ref set by door + date this run
  app_leads_ambiguous int,                       -- more than one CRM lead fitted; left unlinked
  error              text
);

comment on table public.crm_sync_runs is
  'CRM-1. One row per CRM pull. A failed run writes error and applies nothing.';

create index crm_sync_runs_started_idx on public.crm_sync_runs (started_at desc);

-- ---------------------------------------------------------------- RLS
alter table public.crm_status_map enable row level security;
alter table public.crm_leads      enable row level security;
alter table public.crm_sync_runs  enable row level security;

revoke all on public.crm_status_map, public.crm_leads, public.crm_sync_runs from anon, authenticated;
grant select on public.crm_status_map, public.crm_leads, public.crm_sync_runs to authenticated;

create policy crm_status_map_select_staff on public.crm_status_map
  for select to authenticated
  using ((select public.app_role()) in ('admin','office'));

create policy crm_leads_select_staff on public.crm_leads
  for select to authenticated
  using ((select public.app_role()) in ('admin','office'));

create policy crm_sync_runs_select_staff on public.crm_sync_runs
  for select to authenticated
  using ((select public.app_role()) in ('admin','office'));

-- No insert / update / delete policies: default-deny for every API user.
-- The service role bypasses RLS and is the only writer.
