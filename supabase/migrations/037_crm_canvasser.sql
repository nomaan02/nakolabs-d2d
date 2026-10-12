-- 037_crm_canvasser.sql
-- CRM-5 A (owner 2026-10-11, P4b): canvassers see their OWN CRM leads, a
-- daily call-back list with phone numbers, and a leaderboard.
--
-- Owner decisions (2026-10-11):
--   * Each account is linked to a CRM first name (+ branch when names clash)
--     by an admin: profiles.crm_name / profiles.crm_branch.
--   * Call-back list: own leads that are UTC, have no outcome, are Re-App, or
--     are Blowouts whose notes give a reason to ring back (single sit, not
--     convenient, no time, RTA, rearrange, no answer, UTC). Never TITC, RITC,
--     cancelled, not interested, changed mind, wrong number, already done.
--     The reason is a label in crm_leads.callback_reason; the note is never
--     stored (lib/crm/parse.ts decides).
--   * Phone numbers ARE stored, for call-back leads only, in crm_contacts:
--     title, surname, phone, alt phone. Only the canvasser whose lead it is
--     can read a row (not admin, not office). Every row is deleted 90 days
--     after the lead was booked (pg_cron job crm-contacts-purge).
--   * Ticking a call off writes crm_callbacks through the offline queue
--     (client_event_id unique; insert only; latest result wins).
--   * Leaderboard: everyone in the CRM, first names, Bristol branches,
--     totals only (crm_leaderboard, SECURITY DEFINER, aggregates only).

-- ---------------------------------------------------------------- profiles
alter table public.profiles
  add column if not exists crm_name   text,
  add column if not exists crm_branch text;

comment on column public.profiles.crm_name is
  'CRM-5 A. The CRM canvasser first name this account books leads under (crm_leads.canvasser_first_name). Set by an admin. Null = no CRM link.';
comment on column public.profiles.crm_branch is
  'CRM-5 A. Optional CRM branch, set when two people in the CRM share the first name. Null = any branch.';

create or replace function public.my_crm_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.crm_name from public.profiles p where p.id = auth.uid() and p.active;
$$;

create or replace function public.my_crm_branch()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.crm_branch from public.profiles p where p.id = auth.uid() and p.active;
$$;

revoke all on function public.my_crm_name()   from public, anon;
revoke all on function public.my_crm_branch() from public, anon;
grant execute on function public.my_crm_name()   to authenticated;
grant execute on function public.my_crm_branch() to authenticated;

-- Admin links an account to a CRM name (A1). Null name = unlink.
create or replace function public.admin_set_crm_name(p_profile_id uuid, p_crm_name text, p_crm_branch text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'Only an admin can link a CRM name.' using errcode = '42501', hint = 'not_admin';
  end if;
  if p_profile_id is null then
    raise exception 'An account is needed.' using errcode = '22023', hint = 'missing_argument';
  end if;
  update public.profiles
     set crm_name   = nullif(btrim(p_crm_name), ''),
         crm_branch = case when nullif(btrim(p_crm_name), '') is null then null else nullif(btrim(p_crm_branch), '') end
   where id = p_profile_id;
  if not found then
    raise exception 'That account does not exist.' using errcode = 'P0002', hint = 'not_found';
  end if;
end;
$$;

revoke all on function public.admin_set_crm_name(uuid, text, text) from public, anon;
grant execute on function public.admin_set_crm_name(uuid, text, text) to authenticated;

-- Admin picker: every CRM first name with its branch, lead count and latest lead.
create or replace function public.crm_canvasser_names()
returns table (canvasser text, branch text, leads bigint, latest timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.canvasser_first_name, l.branch, count(*), max(l.crm_created_at)
    from public.crm_leads l
   where l.canvasser_first_name is not null
     and (select public.app_role()) = 'admin'
   group by 1, 2
   order by 1, 3 desc;
$$;

revoke all on function public.crm_canvasser_names() from public, anon;
grant execute on function public.crm_canvasser_names() to authenticated;

-- ---------------------------------------------------------------- crm_leads
alter table public.crm_leads
  add column if not exists callback_reason text
    check (callback_reason in ('utc','no_outcome','reapp','single_sit','not_convenient','no_time','rta','rearrange','no_answer'));

comment on column public.crm_leads.callback_reason is
  'CRM-5 A. Why this lead belongs on its canvasser''s call-back list (label only, decided in lib/crm/parse.ts from the status and the Result notes; the notes are never stored). Null = not a call-back.';

create index if not exists crm_leads_canvasser_idx on public.crm_leads (canvasser_first_name, crm_created_at desc);

-- A canvasser (or an admin who canvasses) reads their OWN CRM leads.
create policy crm_leads_select_own on public.crm_leads
  for select to authenticated
  using (
    canvasser_first_name = (select public.my_crm_name())
    and ((select public.my_crm_branch()) is null or branch = (select public.my_crm_branch()))
  );

-- ------------------------------------------------------------- crm_contacts
create table public.crm_contacts (
  crm_id      text primary key references public.crm_leads(crm_id) on delete cascade,
  title       text,
  surname     text,
  phone       text,
  alt_phone   text,
  purge_after date not null,
  synced_at   timestamptz not null default now()
);

comment on table public.crm_contacts is
  'CRM-5 A (owner 2026-10-11). Phone, title and surname for call-back leads only. Written by the server sync (service role). Readable only by the canvasser whose lead it is. Deleted after purge_after (lead date + 90 days) by pg_cron job crm-contacts-purge.';

alter table public.crm_contacts enable row level security;
revoke all on public.crm_contacts from anon, authenticated;
grant select on public.crm_contacts to authenticated;

create policy crm_contacts_select_own on public.crm_contacts
  for select to authenticated
  using (
    exists (
      select 1 from public.crm_leads l
       where l.crm_id = crm_contacts.crm_id
         and l.canvasser_first_name = (select public.my_crm_name())
         and ((select public.my_crm_branch()) is null or l.branch = (select public.my_crm_branch()))
    )
  );

create index crm_contacts_purge_idx on public.crm_contacts (purge_after);

-- ------------------------------------------------------------ crm_callbacks
create table public.crm_callbacks (
  id              uuid primary key default gen_random_uuid(),
  client_event_id uuid not null unique,
  crm_id          text not null references public.crm_leads(crm_id) on delete cascade,
  canvasser_id    uuid not null references public.profiles(id),
  result          text not null check (result in ('rebooked','no_answer','later','not_interested','wrong_number')),
  call_back_on    date,
  called_at       timestamptz not null,
  created_at      timestamptz not null default now(),
  constraint crm_callbacks_later_needs_date check ((result = 'later') = (call_back_on is not null))
);

comment on table public.crm_callbacks is
  'CRM-5 A. One row per call-back result a canvasser logs (offline queue op crm_callback). Insert only; the latest row per lead wins. Never written to the CRM.';

alter table public.crm_callbacks enable row level security;
revoke all on public.crm_callbacks from anon, authenticated;
grant select, insert on public.crm_callbacks to authenticated;

create policy crm_callbacks_insert_own on public.crm_callbacks
  for insert to authenticated
  with check (
    canvasser_id = (select auth.uid())
    and exists (
      select 1 from public.crm_leads l
       where l.crm_id = crm_callbacks.crm_id
         and l.canvasser_first_name = (select public.my_crm_name())
         and ((select public.my_crm_branch()) is null or l.branch = (select public.my_crm_branch()))
    )
  );

create policy crm_callbacks_select_own on public.crm_callbacks
  for select to authenticated
  using (canvasser_id = (select auth.uid()) or (select public.app_role()) in ('admin','office'));

create index crm_callbacks_lead_idx on public.crm_callbacks (crm_id, called_at desc);

-- ------------------------------------------------------------------ reads
-- My CRM leads in a window: results, the week calendar and the map layer.
create or replace function public.my_crm_leads(p_from timestamptz, p_to timestamptz)
returns table (
  crm_id text, status text, crm_created_at timestamptz, appointment_at timestamptz,
  sale_amount numeric, callback_reason text, uprn bigint, lon double precision, lat double precision,
  house_number text, building_name text, street_name text, postcode_sector text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.crm_id, l.status, l.crm_created_at, l.appointment_at, l.sale_amount, l.callback_reason, l.uprn,
         public.st_x(l.location), public.st_y(l.location),
         dl.house_number, dl.building_name, dl.street_name, l.postcode_sector
    from public.crm_leads l
    left join public.v_door_label dl on dl.uprn = l.uprn
   where l.canvasser_first_name = (select public.my_crm_name())
     and ((select public.my_crm_branch()) is null or l.branch = (select public.my_crm_branch()))
     and l.crm_created_at >= p_from and l.crm_created_at < p_to
   order by l.crm_created_at desc;
$$;

-- My call-back list: leads with a reason, booked in the last p_days days,
-- with the contact and my latest call result. The phone decides who to show
-- what; the list rules (To call / Done today / off) live in lib/field.
create or replace function public.my_crm_callbacks(p_days int)
returns table (
  crm_id text, status text, callback_reason text, crm_created_at timestamptz, appointment_at timestamptz,
  title text, surname text, phone text, alt_phone text,
  uprn bigint, house_number text, building_name text, street_name text, postcode_sector text,
  last_result text, last_called_at timestamptz, call_back_on date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.crm_id, l.status, l.callback_reason, l.crm_created_at, l.appointment_at,
         c.title, c.surname, c.phone, c.alt_phone,
         l.uprn, dl.house_number, dl.building_name, dl.street_name, l.postcode_sector,
         cb.result, cb.called_at, cb.call_back_on
    from public.crm_leads l
    join public.crm_contacts c on c.crm_id = l.crm_id
    left join public.v_door_label dl on dl.uprn = l.uprn
    left join lateral (
      select x.result, x.called_at, x.call_back_on
        from public.crm_callbacks x
       where x.crm_id = l.crm_id and x.canvasser_id = (select auth.uid())
       order by x.called_at desc, x.created_at desc
       limit 1
    ) cb on true
   where l.callback_reason is not null
     and l.canvasser_first_name = (select public.my_crm_name())
     and ((select public.my_crm_branch()) is null or l.branch = (select public.my_crm_branch()))
     and l.crm_created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90))
   order by l.crm_created_at desc;
$$;

-- Leaderboard: totals per CRM first name and branch, Bristol branches only.
-- SECURITY DEFINER because canvassers cannot read other people's leads; it
-- returns aggregates only (no lead, door, contact or note).
create or replace function public.crm_leaderboard(p_from timestamptz, p_to timestamptz)
returns table (canvasser text, branch text, leads bigint, sold bigint, pitched bigint, revenue numeric, sales_with_amount bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select l.canvasser_first_name, l.branch,
         count(*),
         count(*) filter (where l.status = 'sale'),
         count(*) filter (where l.status in ('sale','pm')),
         coalesce(sum(l.sale_amount) filter (where l.status = 'sale'), 0),
         count(*) filter (where l.status = 'sale' and l.sale_amount is not null)
    from public.crm_leads l
   where (select public.app_role()) is not null
     and l.canvasser_first_name is not null
     and l.branch ilike '%bristol%'
     and l.crm_created_at >= p_from and l.crm_created_at < p_to
     and p_to - p_from <= interval '400 days'
   group by 1, 2;
$$;

revoke all on function public.my_crm_leads(timestamptz, timestamptz)    from public, anon;
revoke all on function public.my_crm_callbacks(int)                     from public, anon;
revoke all on function public.crm_leaderboard(timestamptz, timestamptz) from public, anon;
grant execute on function public.my_crm_leads(timestamptz, timestamptz)    to authenticated;
grant execute on function public.my_crm_callbacks(int)                     to authenticated;
grant execute on function public.crm_leaderboard(timestamptz, timestamptz) to authenticated;

-- ------------------------------------------------------------------ purge
select cron.schedule(
  'crm-contacts-purge',
  '20 3 * * *',
  $$delete from public.crm_contacts where purge_after < current_date$$
);
