-- 034_crm_insights.sql
-- CRM-2 Session A (2026-10-10). Owner decisions 2026-10-10 (P4a): a "Company
-- CRM" section on Insights with period chips, a 250 m heat map on Coverage,
-- and every CRM door by latest outcome on Coverage and Props. Admin and
-- office only; read-only; SECURITY INVOKER so crm_leads RLS still applies.
--
--   crm_insights(p_from, p_to)  one JSON document for the Insights section:
--       totals, months, days (windows up to 92 days), sectors, props,
--       confirmed (this London week, whatever the period).
--   crm_heat_grid(p_from, p_to) 250 m squares (British National Grid) with 5+
--       placed leads: centre, leads, sales, pitched, revenue.
--   crm_door_history()          one row per door with CRM history: latest
--       outcome and its date, counts per outcome, the door's point.
--
-- A lead's date is its CRM created time ("lead pulled"), in London days.
-- Windows are half-open [p_from, p_to); null = open-ended.
-- Pitched = sale + pm. Revenue = sum of sale_amount on sales.

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
  v_daily boolean := p_from is not null and p_to is not null and p_to - p_from <= interval '92 days';
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
             and cl.appointment_at < v_week_start + interval '7 days'
        ) r), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

comment on function public.crm_insights(timestamptz, timestamptz) is
  'CRM-2 A. Admin/office. Insights "Company CRM" numbers for a created-date window; confirmed = this London week.';

create or replace function public.crm_heat_grid(
  p_from timestamptz default null,
  p_to timestamptz default null
)
 returns table (lon double precision, lat double precision, leads int, sales int, pitched int, revenue numeric)
 language plpgsql
 stable
 security invoker
 set search_path to ''
as $function$
#variable_conflict use_column
begin
  if (select public.app_role()) is distinct from 'admin' and (select public.app_role()) is distinct from 'office' then
    raise exception 'Only admin or office can read the CRM heat map.' using errcode = '42501', hint = 'not_staff';
  end if;

  return query
  with pts as (
    select public.st_transform(c.location, 27700) as g, c.status, c.sale_amount
      from public.crm_leads c
     where c.location is not null
       and (p_from is null or c.crm_created_at >= p_from)
       and (p_to is null or c.crm_created_at < p_to)
  ), cells as (
    select floor(public.st_x(pts.g) / 250) as cx,
           floor(public.st_y(pts.g) / 250) as cy,
           count(*)::int as n,
           (count(*) filter (where pts.status = 'sale'))::int as s,
           (count(*) filter (where pts.status in ('sale', 'pm')))::int as p,
           coalesce(sum(pts.sale_amount) filter (where pts.status = 'sale'), 0) as r
      from pts
     group by 1, 2
    having count(*) >= 5
  )
  select public.st_x(ctr), public.st_y(ctr), cells.n, cells.s, cells.p, cells.r
    from cells
    cross join lateral (
      select public.st_transform(public.st_setsrid(public.st_point(cells.cx * 250 + 125, cells.cy * 250 + 125), 27700), 4326) as ctr
    ) k
   order by cells.cx, cells.cy;
end;
$function$;

comment on function public.crm_heat_grid(timestamptz, timestamptz) is
  'CRM-2 A. Admin/office. 250 m squares (EPSG:27700) with 5+ placed CRM leads in the window.';

create or replace function public.crm_door_history()
 returns table (
   uprn bigint, lon double precision, lat double precision,
   latest_status text, latest_at timestamptz,
   leads int, sale int, pm int, blowout int, utc int, other int
 )
 language plpgsql
 stable
 security invoker
 set search_path to ''
as $function$
#variable_conflict use_column
begin
  if (select public.app_role()) is distinct from 'admin' and (select public.app_role()) is distinct from 'office' then
    raise exception 'Only admin or office can read CRM door history.' using errcode = '42501', hint = 'not_staff';
  end if;

  return query
  with per as (
    select c.uprn,
           count(*)::int as n,
           (count(*) filter (where c.status = 'sale'))::int as s,
           (count(*) filter (where c.status = 'pm'))::int as pmc,
           (count(*) filter (where c.status = 'blowout'))::int as b,
           (count(*) filter (where c.status = 'utc'))::int as u,
           (count(*) filter (where c.status is null or c.status not in ('sale', 'pm', 'blowout', 'utc')))::int as o
      from public.crm_leads c
     where c.uprn is not null
     group by c.uprn
  ), latest as (
    select distinct on (c.uprn) c.uprn, c.status, c.crm_created_at
      from public.crm_leads c
     where c.uprn is not null
     order by c.uprn, c.crm_created_at desc, c.crm_id desc
  )
  select per.uprn, public.st_x(p.geom), public.st_y(p.geom),
         latest.status, latest.crm_created_at,
         per.n, per.s, per.pmc, per.b, per.u, per.o
    from per
    join latest on latest.uprn = per.uprn
    join public.properties p on p.uprn = per.uprn
   order by per.uprn;
end;
$function$;

comment on function public.crm_door_history() is
  'CRM-2 A. Admin/office. Every door with CRM history: latest outcome (null = No outcome), counts, point.';

revoke all on function public.crm_insights(timestamptz, timestamptz) from public, anon;
revoke all on function public.crm_heat_grid(timestamptz, timestamptz) from public, anon;
revoke all on function public.crm_door_history() from public, anon;
grant execute on function public.crm_insights(timestamptz, timestamptz) to authenticated;
grant execute on function public.crm_heat_grid(timestamptz, timestamptz) to authenticated;
grant execute on function public.crm_door_history() to authenticated;
