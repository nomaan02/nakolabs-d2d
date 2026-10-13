-- 039_crm_layer_window.sql
-- CRM-6 C (owner 2026-10-13): the Coverage CRM layer follows the Days chip.
-- crm_heat_grid already takes p_from / p_to (034); crm_door_history did not,
-- so "Doors: Sold" looked the same for any period. It now takes the same
-- optional window (CRM date booked, [p_from, p_to)); both null = all CRM
-- history, as before, so the Props map's call without arguments is unchanged.
-- Body otherwise identical to 034. Admin and office only, as before.
--
-- crm_heat_grid (owner 2026-10-13): a square shows from 5 leads for a window
-- of three months or longer (or no window), from 2 leads for anything
-- shorter, so "Last 30 days" is a real picture. Same signature, body only
-- (create or replace), so its grants and comment stay as 034 left them.
-- lib/admin/crm-map.ts heatMinLeads() is the same rule.

drop function if exists public.crm_door_history();

create function public.crm_door_history(p_from timestamptz default null, p_to timestamptz default null)
returns table (uprn bigint, lon double precision, lat double precision, latest_status text, latest_at timestamptz, leads integer, sale integer, pm integer, blowout integer, utc integer, other integer)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select public.app_role()) is distinct from 'admin' and (select public.app_role()) is distinct from 'office' then
    raise exception 'Only admin or office can read CRM door history.' using errcode = '42501', hint = 'not_staff';
  end if;

  return query
  with win as (
    select c.uprn, c.status, c.crm_created_at, c.crm_id
      from public.crm_leads c
     where c.uprn is not null
       and (p_from is null or c.crm_created_at >= p_from)
       and (p_to is null or c.crm_created_at < p_to)
  ), per as (
    select w.uprn,
           count(*)::int as n,
           (count(*) filter (where w.status = 'sale'))::int as s,
           (count(*) filter (where w.status = 'pm'))::int as pmc,
           (count(*) filter (where w.status = 'blowout'))::int as b,
           (count(*) filter (where w.status = 'utc'))::int as u,
           (count(*) filter (where w.status is null or w.status not in ('sale', 'pm', 'blowout', 'utc')))::int as o
      from win w
     group by w.uprn
  ), latest as (
    select distinct on (w.uprn) w.uprn, w.status, w.crm_created_at
      from win w
     order by w.uprn, w.crm_created_at desc, w.crm_id desc
  )
  select per.uprn, public.st_x(p.geom), public.st_y(p.geom),
         latest.status, latest.crm_created_at,
         per.n, per.s, per.pmc, per.b, per.u, per.o
    from per
    join latest on latest.uprn = per.uprn
    join public.properties p on p.uprn = per.uprn
   order by per.uprn;
end;
$$;

comment on function public.crm_door_history(timestamptz, timestamptz) is
  'CRM-2 A / CRM-6 C. Admin/office. Every door with CRM leads booked in [p_from, p_to) (null = no limit): latest outcome in that window (null = No outcome), counts, point.';

revoke all on function public.crm_door_history(timestamptz, timestamptz) from public, anon;
grant execute on function public.crm_door_history(timestamptz, timestamptz) to authenticated;

create or replace function public.crm_heat_grid(p_from timestamptz default null, p_to timestamptz default null)
returns table (lon double precision, lat double precision, leads integer, sales integer, pitched integer, revenue numeric)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_min int := case
    when p_from is not null
     and (coalesce(p_to, now()) at time zone 'Europe/London')::date - (p_from at time zone 'Europe/London')::date < 89 then 2
    else 5
  end;
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
    having count(*) >= v_min
  )
  select public.st_x(ctr), public.st_y(ctr), cells.n, cells.s, cells.p, cells.r
    from cells
    cross join lateral (
      select public.st_transform(public.st_setsrid(public.st_point(cells.cx * 250 + 125, cells.cy * 250 + 125), 27700), 4326) as ctr
    ) k
   order by cells.cx, cells.cy;
end;
$$;

comment on function public.crm_heat_grid(timestamptz, timestamptz) is
  'CRM-2 A / CRM-6 C. Admin/office. 250 m squares (EPSG:27700) of CRM leads booked in [p_from, p_to) (null = no limit): leads, sales, pitched, revenue. A square shows from 5 leads, or from 2 when the window is under 89 London days (lib/admin/crm-map.ts heatMinLeads).';
