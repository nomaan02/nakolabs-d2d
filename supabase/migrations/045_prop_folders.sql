-- 045_prop_folders.sql
-- PP-1 (owner 2026-10-21): props organised into folders the admin names.
-- One folder per prop (or none). Folders can be created and renamed; delete is
-- parked (owner 2026-10-21), so there is deliberately no DELETE policy.
-- Archived props stay inside their folder (owner 2026-10-21).
-- Additive only: a new table and one nullable column. Nothing existing changes.

create table public.prop_folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

-- No two folders with the same name (ignoring case and outer spaces).
create unique index prop_folders_name_key on public.prop_folders (lower(btrim(name)));

comment on table public.prop_folders is
  'PP-1 (owner 2026-10-21). Admin-named folders that group props (territories.folder_id). Readable by any signed-in role, written by the admin only. No delete (parked).';

alter table public.prop_folders enable row level security;

create policy prop_folders_select on public.prop_folders
  for select to authenticated
  using ((select public.app_role()) is not null);

create policy prop_folders_insert_admin on public.prop_folders
  for insert to authenticated
  with check ((select public.app_role()) = 'admin');

create policy prop_folders_update_admin on public.prop_folders
  for update to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

-- The prop's folder. Null = "No folder". Existing territories policies already
-- limit UPDATE to the admin, so moving a prop needs no new policy.
alter table public.territories
  add column folder_id uuid references public.prop_folders(id) on delete set null;

create index territories_folder_id_idx on public.territories (folder_id);

comment on column public.territories.folder_id is
  'PP-1 (owner 2026-10-21). The prop''s folder; null shows under "No folder".';
