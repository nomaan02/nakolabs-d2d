---
name: Stage 2 schema and RLS
overview: Write and apply migration `003_core.sql` (seven Stage 2 tables, SELECT policies for the two Stage 1 tables, column grants + triggers on `leads`, team-size trigger), verify every policy with simulated-role transactions, regenerate types and type-check.
todos:
  - id: write-003
    content: "Write supabase/migrations/003_core.sql: 7 tables, indexes, helper fns, triggers, RLS enable, policies, grants/revokes, properties/nccz_zones SELECT policies"
    status: completed
  - id: apply-003
    content: supabase db push --linked (dry-run, then apply); reload PostgREST schema
    status: completed
  - id: test-rls
    content: Run simulated-role transaction tests for each acceptance item, capture denied and allowed outputs
    status: completed
  - id: regen-types
    content: Regenerate lib/supabase/types.ts and run npx tsc --noEmit
    status: completed
  - id: build-log
    content: Append Stage 02 entry to docs/BUILD-LOG.md with queries, outputs, deviations, Stage 8 client_event_id note
    status: completed
isProject: false
---

# Stage 2 — Full schema and RLS

## Restatement (run-stage step 3)

- Builds: `supabase/migrations/003_core.sql` with `profiles`, `territories`, `assignments`, `assignment_members`, `knock_events`, `leads`, `property_observations`; RLS + policies on all seven; SELECT policies for `properties` and `nccz_zones`; column grants and a guard trigger on `leads`; a max-three-members trigger on `assignment_members`. Then regenerate [lib/supabase/types.ts](lib/supabase/types.ts).
- Must not touch: `001`/`002` (applied, confirmed remote versions `001`,`002`), no `route_steps`, `amenities`, `territory_visits`, `appointment_slots`, `crm_sync_runs`, `crm_status_map`, no auth, no app routes, no coverage table.
- Acceptance: all tables `rowsecurity = true`; canvasser cannot read another canvasser's knock events; canvasser cannot update `leads.status`; `re_app` lead stays in the pending pipeline; a fourth `assignment_members` row fails (third succeeds, per your amendment); types regenerated and `tsc --noEmit` passes.

Verified pre-conditions: `properties` and `nccz_zones` exist with RLS on and zero policies; `auth.uid()` exists; `auth.users` is empty; the DB-facing tool runs as `postgres` (BYPASSRLS = true, so every test **must** `set local role authenticated`); default grants give `anon`/`authenticated` ALL privileges on every new table (cloud auto-expose), which is why explicit revokes matter.

## Exact list of tables created (7)

1. `profiles` — `id uuid pk references auth.users(id) on delete cascade`, `full_name`, `role check in ('admin','office','canvasser')`, `active`, `created_at`. As per brief.
2. `territories` — as per brief. GiST on `geom`.
3. `assignments` — as per brief incl. `unique (territory_id, work_date)`. GiST on `route_geom`, B-tree on `work_date`.
4. `assignment_members` — as per brief. B-tree on `canvasser_id`. Trigger `assignment_members_max_three`.
5. `knock_events` — as per brief. B-trees on `assignment_id`, `uprn` (given) plus `canvasser_id` (RLS filter column).
6. `leads` — brief DDL **plus two agreed additions**: `client_event_id text unique not null` (shared with the producing `knock_events.client_event_id` — one door-visit action, one id, both rows; recorded in a column comment and in BUILD-LOG follow-ups for Stage 8) and `unique (knock_event_id)`. Keeps `crm_ref`, `crm_last_synced_at`. B-trees on `canvasser_id`, `uprn`, `status`.
7. `property_observations` — as per brief. B-trees on `uprn`, `canvasser_id`.

Not created: anything else. Two helper functions and two trigger functions are created (below); no views.

## Column-level restriction on `leads.status` — chosen mechanism

**Primary: column-level GRANTs on the `authenticated` DB role. Secondary: a BEFORE INSERT/UPDATE trigger. RLS decides *who*; grants decide *which columns*.**

Why grants, not RLS: every logged-in user (admin, office, canvasser) is the same Postgres role `authenticated`, and RLS only filters rows. Column privileges are enforced by the privilege system before any policy or trigger runs, cannot be widened by a later policy mistake, and are inspectable in `information_schema.column_privileges`.

```sql
revoke all on public.leads from anon, authenticated;
grant select on public.leads to authenticated;
-- canvasser-supplied fields only. No status, status_set_*, crm_*.
grant insert (id, client_event_id, knock_event_id, uprn, canvasser_id,
              booked_for, is_immediate, notes) on public.leads to authenticated;
-- the four office-settable columns, and nothing else.
grant update (status, status_set_at, status_set_by, booked_for) on public.leads to authenticated;
-- no delete for anyone but service_role
```

Effect: a canvasser inserting `status = 'sale'` gets `permission denied for table leads`; `status` falls to its default `'pending'`. Office updating `notes` or `crm_ref` gets `permission denied`. Office/service role may update the four columns.

Why the grant alone is not enough: it cannot tell office from canvasser. That is done by RLS — the only UPDATE policy on `leads` is `using/with check ((select app_role()) = 'office')`; canvassers have no UPDATE policy, so their update matches zero rows. Defence in depth: trigger `leads_guard_status()` (BEFORE INSERT OR UPDATE OF status) raises if `app_role() = 'canvasser'` and the row's `status` is not `'pending'` on insert or changes on update. The trigger is a no-op for service role / postgres (`auth.uid()` is null). It is the backstop if someone later adds a canvasser UPDATE policy.

Rejected: trigger-only (invisible in privilege metadata, relies on the function being correct for every path); RLS-only (cannot express columns — a canvasser UPDATE policy for e.g. `notes` would also open `status`).

## Helper functions (security definer, `set search_path = public`, execute granted to `authenticated` only)

- `app_role() returns text` — `select role from profiles where id = auth.uid() and active`. Security definer avoids self-referential RLS on `profiles`. Always used as `(select public.app_role())` inside policies so it is evaluated once per statement, not per row.
- `is_assignment_member(a uuid) returns boolean` — `exists (select 1 from assignment_members where assignment_id = a and canvasser_id = auth.uid())`. Security definer breaks the `assignments` <-> `assignment_members` policy recursion.

## Policy matrix (default deny; only these exist)

- `properties`, `nccz_zones`: SELECT `to authenticated using (true)`. No anon, no write. Also `revoke all from anon` on both.
- `profiles`: SELECT own (`id = auth.uid()`); SELECT all for admin. No insert/update/delete for any JWT role (Stage 3 trigger and service role write).
- `territories`: SELECT for any active profile (`app_role() is not null`); INSERT/UPDATE/DELETE admin.
- `assignments`: ALL admin; SELECT canvasser where `is_assignment_member(id)`.
- `assignment_members`: ALL admin; SELECT where `is_assignment_member(assignment_id)` — a canvasser sees their teammates' rows too (needed for partner position later; stated interpretation of "rows where they are a member").
- `knock_events`: INSERT canvasser with check `canvasser_id = auth.uid() and is_assignment_member(assignment_id)`; SELECT own; SELECT all admin. No UPDATE/DELETE (immutable event log).
- `leads`: INSERT canvasser with check `canvasser_id = auth.uid()` and the referenced knock event is theirs; SELECT own; SELECT all office and admin; UPDATE office only (columns limited by grant above). No DELETE.
- `property_observations`: INSERT canvasser with check `canvasser_id = auth.uid()`; SELECT all admin. No canvasser read (brief says inserts only).
- All seven new tables: `revoke all from anon`.
- Office is *not* given read on `knock_events`, `assignments`, `profiles` beyond own row — the brief does not grant it; later stages add what they need.

## Triggers

- `assignment_members_max_three` BEFORE INSERT: `select 1 from assignments where id = new.assignment_id for update` (serialises concurrent inserts), then `if count(*) >= 3 then raise exception 'A team is one to three canvassers'`. Third insert succeeds, fourth fails. Comment in migration updated to "1 to 3" (brief text says 1 or 2; you amended it).
- `leads_guard_status` as above.

## Test harness (per new-migration skill)

All tests run through one SQL transaction per acceptance item: `begin; <fixtures>; <DO block with per-case exception handlers writing to a temp results table>; select * from results; rollback;`. Confirmed that the tool returns the `select` result before `rollback`, so nothing persists. Fixtures: three `auth.users` rows (canvasser A, canvasser B, office O) with fixed UUIDs, matching `profiles`, one territory, one assignment, memberships, knock events for A and B, one lead for A. Role simulation: `perform set_config('role','authenticated',true); perform set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}',true);` and `set_config('role','anon',true)` for anon.

Per acceptance item, both cases shown with actual output:

- rowsecurity: `select tablename, rowsecurity from pg_tables where schemaname='public'` — expect 9 true (`spatial_ref_sys` is PostGIS-owned, reported separately).
- knock_events isolation: as A, `select id from knock_events` returns only A's; as B, only B's; as admin, both; as anon, 0/denied.
- leads.status: as canvasser A, `update leads set status='sale' where id=... returning id` -> 0 rows and status still `pending`; as A `insert ... status='sale'` -> permission denied (grant); as A `update leads set notes='x'` -> permission denied (grant); as office O `update status='sale'` -> 1 row (allowed); as O `update notes` -> permission denied; trigger unit test: as `postgres` with A's claims set, `update status='sale'` -> raised by `leads_guard_status`.
- re_app: as O set status `re_app`; as A and as O, `select id from leads where status in ('pending','re_app')` includes it; also loop all eight statuses through the check constraint (each accepted) and a ninth bogus value rejected.
- team size: insert members 1, 2, 3 -> count 3; insert 4th -> exception text.
- properties/nccz_zones: as authenticated `select count(*) from properties` > 0; as anon -> 0 rows or permission denied; as authenticated `insert` -> denied.

## Apply, regenerate, type-check

- `supabase db push --linked --project-ref xerxsaptwpvhkkpyvkfi --yes` (same as Stage 1; `--dry-run` first).
- `notify pgrst, 'reload schema'`.
- `cmd /c "supabase gen types typescript --linked --project-ref xerxsaptwpvhkkpyvkfi > lib/supabase/types.ts"`, then `npx tsc --noEmit`.
- Append Stage 02 entry to [docs/BUILD-LOG.md](docs/BUILD-LOG.md): acceptance per item with queries and outputs, deviations (leads `client_event_id` + `unique(knock_event_id)`, team size 1 to 3, extra B-tree indexes, anon revokes, `app_role()` gated on `active`), follow-ups including the Stage 8 note: one `client_event_id` per door-visit action reused for the `knock_events` insert and the `leads` insert when outcome is `lead`.

Noted for Stage 8: the lead-creation step in the field logger generates one `client_event_id` per door-visit action and uses it for both rows. This goes in the migration column comment and BUILD-LOG follow-ups so it survives this session.