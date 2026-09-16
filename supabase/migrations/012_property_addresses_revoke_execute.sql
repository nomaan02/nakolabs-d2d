-- Stage 1c follow-up: ingest RPCs were created with Supabase default
-- EXECUTE grants to anon and authenticated. 011 revoked PUBLIC only.
-- Table writes are already denied; this closes the EXECUTE hole.

revoke all on function public.upsert_property_addresses(jsonb)
  from public, anon, authenticated;
revoke all on function public.list_property_uprns(bigint, integer)
  from public, anon, authenticated;

grant execute on function public.upsert_property_addresses(jsonb) to service_role;
grant execute on function public.list_property_uprns(bigint, integer) to service_role;
