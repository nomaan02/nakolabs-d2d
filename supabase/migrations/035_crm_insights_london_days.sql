-- 035_crm_insights_london_days.sql
-- CRM-2 follow-up (2026-10-10). Two clock-change fixes to crm_insights (034),
-- found in review. Nothing else changes; same signature, same grants.
--
--   1. "Daily" windows were measured in hours, so a 3-month window that
--      crosses the end of British Summer Time (92 days + 1 hour) fell back
--      to months. Now: London calendar days, 92 or fewer = daily.
--   2. "Confirmed this week" ended 168 hours after Monday 00:00 London. In
--      the week the clocks change that is an hour out. Now: next Monday
--      00:00 London.

create or replace function public.crm_insights(
  p_from timestamptz default null,
  p_to timestamptz default null
)
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to ''
as $function$
declare
  v_week_start timestamptz := (date_trunc('week', (now() at time zone 'Europe/London')) at time zone 'Europe/London');
  -- London wall-clock week end (a DST week is 167 or 169 hours, not 168).
  v_week_end timestamptz := ((date_trunc('week', (now() at time zone 'Europe/London')) + interval '7 days') at time zone 'Europe/London');
  -- Count London calendar days, so a window that crosses a clock change stays daily.
  v_daily boolean := p_from is not null and p_to is not null
    and ((p_to at time zone 'Europe/London')::date - (p_from at time zone 'Europe/London')::date) <= 92;
  v_result jsonb;
begin
  if (select public.app_role()) is distinct from 'admin' and (select public.app_role()) is distinct from 'office' then
    raise exception 'Only admin or office can read CRM insights.' using errcode = '42501', hint = 'not_staff';
  end if;

  with w as (
    select c.*
      from public.crm_leads c
     where (p_from is null or c.crm_created_at >= p_from)
       and (p_to is null or c.crm_created_at < p_to)
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'leads', count(*),
        'sale', count(*) filter (where status = 'sale'),
        'pm', count(*) filter (where status = 'pm'),
        'blowout', count(*) filter (where status = 'blowout'),
        'utc', count(*) filter (where status = 'utc'),
        're_app', count(*) filter (where status = 're_app'),
        'confirmed', count(*) filter (where status = 'confirmed'),
        'pending', count(*) filter (where status = 'pending'),
        'no_outcome', count(*) filter (where status is null),
        'revenue', coalesce(sum(sale_amount) filter (where status = 'sale'), 0),
        'sales_with_amount', count(*) filter (where status = 'sale' and sale_amount is not null),
        'placed', count(*) filter (where location is not null)
      ) from w),
    'months', coalesce((
      select jsonb_agg(m order by m->>'month')
        from (
          select jsonb_build_object(
            'month', to_char(date_trunc('month', crm_created_at at time zone 'Europe/London'), 'YYYY-MM'),
            'leads', count(*),
            'sale', count(*) filter (where status = 'sale'),
            'pm', count(*) filter (where status = 'pm'),
            'blowout', count(*) filter (where status = 'blowout'),
            'utc', count(*) filter (where status = 'utc'),
            're_app', count(*) filter (where status = 're_app'),
            'confirmed', count(*) filter (where status = 'confirmed'),
            'pending', count(*) filter (where status = 'pending'),
            'no_outcome', count(*) filter (where status is null),
            'revenue', coalesce(sum(sale_amount) filter (where status = 'sale'), 0),
            'sales_with_amount', count(*) filter (where status = 'sale' and sale_amount is not null)
          ) as m
            from w
           group by date_trunc('month', crm_created_at at time zone 'Europe/London')
        ) x), '[]'::jsonb),
    'days', case when v_daily then coalesce((
      select jsonb_agg(d order by d->>'day')
        from (
          select jsonb_build_object(
            'day', to_char(crm_created_at at time zone 'Europe/London', 'YYYY-MM-DD'),
            'leads', count(*),
            'sale', count(*) filter (where status = 'sale'),
            'pm', count(*) filter (where status = 'pm'),
            'blowout', count(*) filter (where status = 'blowout'),
            'utc', count(*) filter (where status = 'utc'),
            're_app', count(*) filter (where status = 're_app'),
            'confirmed', count(*) filter (where status = 'confirmed'),
            'pending', count(*) filter (where status = 'pending'),
            'no_outcome', count(*) filter (where status is null),
            'revenue', coalesce(sum(sale_amount) filter (where status = 'sale'), 0),
            'sales_with_amount', count(*) filter (where status = 'sale' and sale_amount is not null)
          ) as d
            from w
           group by to_char(crm_created_at at time zone 'Europe/London', 'YYYY-MM-DD')
        ) y), '[]'::jsonb) end,
    'sectors', coalesce((
      select jsonb_agg(s order by (s->>'leads')::int desc, s->>'sector')
        from (
          select jsonb_build_object(
            'sector', postcode_sector,
            'leads', count(*),
            'sale', count(*) filter (where status = 'sale'),
            'pitched', count(*) filter (where status in ('sale', 'pm')),
            'blowout', count(*) filter (where status = 'blowout'),
            'utc', count(*) filter (where status = 'utc'),
            'revenue', coalesce(sum(sale_amount) filter (where status = 'sale'), 0),
            'sales_with_amount', count(*) filter (where status = 'sale' and sale_amount is not null)
          ) as s
            from w
           where postcode_sector is not null
           group by postcode_sector
        ) z), '[]'::jsonb),
    'props', coalesce((
      select jsonb_agg(p order by (p->>'leads')::int desc, p->>'name')
        from (
          select jsonb_build_object(
            'id', t.id,
            'name', t.name,
            'leads', count(w.crm_id),
            'sale', count(w.crm_id) filter (where w.status = 'sale'),
            'pitched', count(w.crm_id) filter (where w.status in ('sale', 'pm')),
            'revenue', coalesce(sum(w.sale_amount) filter (where w.status = 'sale'), 0),
            'sales_with_amount', count(w.crm_id) filter (where w.status = 'sale' and w.sale_amount is not null)
          ) as p
            from public.territories t
            join w on w.location is not null and public.st_contains(t.geom, w.location)
           where t.archived_at is null
           group by t.id, t.name
        ) q), '[]'::jsonb),
    'confirmed', coalesce((
      select jsonb_agg(c order by c->>'at', c->>'crm_id')
        from (
          select jsonb_build_object(
            'crm_id', cl.crm_id,
            'at', cl.appointment_at,
            'sector', cl.postcode_sector,
            'uprn', cl.uprn,
            'house_number', dl.house_number,
            'building_name', dl.building_name,
            'street_name', dl.street_name,
            'branch', cl.branch,
            'canvasser', cl.canvasser_first_name
          ) as c
            from public.crm_leads cl
            left join public.v_door_label dl on dl.uprn = cl.uprn
           where cl.status = 'confirmed'
             and cl.appointment_at >= v_week_start
             and cl.appointment_at < v_week_end
        ) r), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

comment on function public.crm_insights(timestamptz, timestamptz) is
  'CRM-2 A (034), London-day fixes in 035. Admin/office. Insights "Company CRM" numbers for a created-date window; confirmed = this London week.';


revoke all on function public.crm_insights(timestamptz, timestamptz) from public, anon;
grant execute on function public.crm_insights(timestamptz, timestamptz) to authenticated;
