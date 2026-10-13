-- 038_crm_callback_details.sql
-- CRM-6 B (owner 2026-10-13): a call-back with only a name is too vague to
-- ring. For call-back leads only, crm_contacts also keeps, as typed in the
-- CRM:
--   * address_line      Street (lane), on one line
--   * result_note       Result (cf_867): what happened, why it didn't sit
--   * product_interest  Product Interest (cf_871): what was booked
--   * best_time         Best Time To Call (cf_1016)
--   * description       Description
-- Same rules as the phone numbers (037): written by the server sync only,
-- readable only by the canvasser whose lead it is (not admin, not office),
-- deleted 90 days after the lead date by pg_cron job crm-contacts-purge.
-- Owner says this is covered by the existing sign-off (2026-10-13).
--
-- my_crm_callbacks gains these five plus the full postcode. Its return type
-- changes, so it is dropped and re-created with the same grants.

alter table public.crm_contacts
  add column if not exists address_line     text,
  add column if not exists result_note      text,
  add column if not exists product_interest text,
  add column if not exists best_time        text,
  add column if not exists description      text;

comment on table public.crm_contacts is
  'CRM-5 A / CRM-6 B (owner 2026-10-11, 2026-10-13). For call-back leads only: title, surname, phones, the CRM address line and the CRM notes (Result, Product Interest, Best Time To Call, Description). Written by the server sync (service role). Readable only by the canvasser whose lead it is. Deleted after purge_after (lead date + 90 days) by pg_cron job crm-contacts-purge.';
comment on column public.crm_contacts.address_line is 'CRM-6 B. CRM Street box on one line, as typed. Call-back leads only.';
comment on column public.crm_contacts.result_note is 'CRM-6 B. CRM Result (cf_867), as typed. Call-back leads only.';
comment on column public.crm_contacts.product_interest is 'CRM-6 B. CRM Product Interest (cf_871), as typed. Call-back leads only.';
comment on column public.crm_contacts.best_time is 'CRM-6 B. CRM Best Time To Call (cf_1016), as typed. Call-back leads only.';
comment on column public.crm_contacts.description is 'CRM-6 B. CRM Description, as typed. Call-back leads only.';

drop function if exists public.my_crm_callbacks(int);

create function public.my_crm_callbacks(p_days int)
returns table (
  crm_id text, status text, callback_reason text, crm_created_at timestamptz, appointment_at timestamptz,
  title text, surname text, phone text, alt_phone text,
  uprn bigint, house_number text, building_name text, street_name text, postcode_sector text,
  last_result text, last_called_at timestamptz, call_back_on date,
  postcode text, address_line text, result_note text, product_interest text, best_time text, description text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.crm_id, l.status, l.callback_reason, l.crm_created_at, l.appointment_at,
         c.title, c.surname, c.phone, c.alt_phone,
         l.uprn, dl.house_number, dl.building_name, dl.street_name, l.postcode_sector,
         cb.result, cb.called_at, cb.call_back_on,
         l.postcode, c.address_line, c.result_note, c.product_interest, c.best_time, c.description
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

revoke all on function public.my_crm_callbacks(int) from public, anon;
grant execute on function public.my_crm_callbacks(int) to authenticated;
