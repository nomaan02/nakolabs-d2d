-- 042_crm_week.sql
-- CRM-7 (owner 2026-10-15; Wayne OK'd the details). The canvasser's "This
-- week" screen: every one of their OWN CRM leads this week, with the CRM
-- status and the same details the call-backs list shows (title, surname,
-- phones, the CRM address line, Result, Product Interest, Best Time To Call,
-- Description), plus a "Refresh from CRM" button.
--
-- What changes:
--   * crm_contacts now holds a row for EVERY lead booked in the last 90 days,
--     not only call-backs (lib/crm/parse.ts and lib/crm/sync.ts). Same rules:
--     written by the server only, readable only by the canvasser whose lead it
--     is (not admin, not office), deleted 90 days after the lead date by
--     pg_cron job crm-contacts-purge. No schema change is needed for that.
--   * my_crm_week(p_from, p_to): the signed-in canvasser's own leads in a
--     window, joined to their contact row. SECURITY INVOKER, so the existing
--     RLS on crm_leads and crm_contacts decides what comes back.
--   * crm_refresh_log: one row per press of Refresh from CRM. Written only by
--     the server route (service role). It enforces the throttle: the partial
--     unique index allows ONE unfinished refresh at a time across everyone.
--   * my_crm_freshness(): when this canvasser last refreshed and when the
--     scheduled sync last finished. Two timestamps, nothing else.

-- ------------------------------------------------------------ crm_refresh_log
create table public.crm_refresh_log (
  id           uuid primary key default gen_random_uuid(),
  canvasser_id uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  rows_seen    integer
);

comment on table public.crm_refresh_log is
  'CRM-7 (owner 2026-10-15). One row per press of Refresh from CRM. Written only by the server route (service role). Throttle: one refresh per canvasser per 30 seconds, and the partial unique index allows one unfinished refresh at a time. Rows older than 7 days are deleted by the route. No lead data.';

alter table public.crm_refresh_log enable row level security;
revoke all on public.crm_refresh_log from anon, authenticated;
-- No policies: default deny. The service role bypasses RLS.

create unique index crm_refresh_one_running on public.crm_refresh_log ((true)) where finished_at is null;
create index crm_refresh_log_canvasser_idx on public.crm_refresh_log (canvasser_id, requested_at desc);

-- ---------------------------------------------------------------- contacts
comment on table public.crm_contacts is
  'CRM-5 A / CRM-6 B / CRM-7 (owner 2026-10-11, 2026-10-13, 2026-10-15). For every lead booked in the last 90 days: title, surname, phones, the CRM address line and the CRM notes (Result, Product Interest, Best Time To Call, Description). Written by the server sync and the canvasser refresh route (service role). Readable only by the canvasser whose lead it is. Deleted after purge_after (lead date + 90 days) by pg_cron job crm-contacts-purge.';

-- -------------------------------------------------------------------- reads
create function public.my_crm_week(p_from timestamptz, p_to timestamptz)
returns table (
  crm_id text, status text, callback_reason text,
  crm_created_at timestamptz, crm_modified_at timestamptz, appointment_at timestamptz,
  sale_amount numeric,
  title text, surname text, phone text, alt_phone text,
  uprn bigint, house_number text, building_name text, street_name text, postcode_sector text,
  postcode text, address_line text, result_note text, product_interest text, best_time text, description text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.crm_id, l.status, l.callback_reason,
         l.crm_created_at, l.crm_modified_at, l.appointment_at,
         l.sale_amount,
         c.title, c.surname, c.phone, c.alt_phone,
         l.uprn, dl.house_number, dl.building_name, dl.street_name, l.postcode_sector,
         l.postcode, c.address_line, c.result_note, c.product_interest, c.best_time, c.description
    from public.crm_leads l
    left join public.crm_contacts c on c.crm_id = l.crm_id
    left join public.v_door_label dl on dl.uprn = l.uprn
   where l.canvasser_first_name = (select public.my_crm_name())
     and ((select public.my_crm_branch()) is null or l.branch = (select public.my_crm_branch()))
     and l.crm_created_at >= p_from
     and l.crm_created_at <  p_to
   order by l.crm_created_at desc;
$$;

revoke all on function public.my_crm_week(timestamptz, timestamptz) from public, anon;
grant execute on function public.my_crm_week(timestamptz, timestamptz) to authenticated;

create function public.my_crm_freshness()
returns table (last_refresh_at timestamptz, last_sync_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select max(r.finished_at) from public.crm_refresh_log r
      where r.canvasser_id = (select auth.uid()) and r.ok is true),
    (select max(s.finished_at) from public.crm_sync_runs s
      where s.error is null and s.finished_at is not null);
$$;

revoke all on function public.my_crm_freshness() from public, anon;
grant execute on function public.my_crm_freshness() to authenticated;
