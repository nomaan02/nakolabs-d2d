-- 036_crm_sync_schedule.sql
-- CRM-4 A (owner 2026-10-11, P3): run the CRM sync every 30 minutes, from
-- about 05:00 to 21:00 London, so lead outcomes show up during a shift.
--
-- Vercel's free plan allows one scheduled run a day, so Supabase does the
-- timing: pg_cron runs public.crm_sync_tick() on the schedule, and the tick
-- asks the app's /api/cron/crm-sync route to sync (pg_net, one GET).
--
-- The address and the password live in Supabase Vault, never in this file:
--   crm_sync_url     e.g. https://<the live app>/api/cron/crm-sync
--   crm_sync_secret  the same value as CRON_SECRET on Vercel
-- Until both exist the tick does nothing, so this migration is safe to apply
-- before the secrets are added.
--
-- pg_cron runs in UTC. '*/30 4-20 * * *' = 04:00 to 20:30 UTC
--   = 05:00 to 21:30 London in summer, 04:00 to 20:30 in winter.
-- The route skips when a run is still going, so ticks never overlap.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.crm_sync_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'crm_sync_url'    limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'crm_sync_secret' limit 1;
  if v_url is null or v_secret is null or length(v_secret) < 16 then
    return null;  -- not configured yet: do nothing
  end if;
  return net.http_get(
    url                  := v_url,
    headers              := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 120000
  );
end;
$$;

comment on function public.crm_sync_tick() is
  'CRM-4 A. Called by pg_cron job crm-sync. Asks /api/cron/crm-sync to pull CRM leads changed since the last run. Reads crm_sync_url and crm_sync_secret from Vault; does nothing until both exist.';

-- Only pg_cron (running as the owner) calls it. Nobody through the API.
revoke all on function public.crm_sync_tick() from public;
revoke all on function public.crm_sync_tick() from anon, authenticated;

-- Same job name again replaces the job, so re-running this file is safe.
select cron.schedule('crm-sync', '*/30 4-20 * * *', 'select public.crm_sync_tick()');

-- pg_cron keeps every run's details forever; keep a week.
select cron.schedule(
  'crm-sync-history-trim',
  '15 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
