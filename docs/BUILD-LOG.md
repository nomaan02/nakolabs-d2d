# Build log

One entry per stage, appended by the agent at the end of each session.

## Format

### Stage NN — <name>
- **Date:**
- **Model:**
- **Built:**
- **Acceptance:** PASS / FAIL / NOT VERIFIED, per item
- **Deviations from brief:**
- **Not done / deferred:**
- **Follow-ups:**

---

### Stage 00 — Scaffold, env verification, deploy skeleton
- **Date:** 2026-09-11
- **Model:** Cursor Grok 4.6
- **Built:** Next.js 15.5.25 App Router (TypeScript, Tailwind v4), Supabase browser/server factories, `/health` route, Supabase keepalive GitHub Action, Vercel production deploy.
- **Acceptance:**
  - `/health` returns green for all four env vars on the deployed Vercel URL: **PASS** (`https://nakolabs-d2d.vercel.app/health` → 200, all checks green including `supabase`)
  - `SUPABASE_SERVICE_ROLE_KEY` does not appear in the client bundle: **PASS** (zero hits for the name or the key value under `.next/static`; `/health` ships 0 B client JS)
  - Keepalive GitHub Action committed and its first run succeeded: **PASS** (https://github.com/nomaan02/nakolabs-d2d/actions/runs/34655468732)
- **Deviations from brief:**
  - Added `@supabase/ssr` and `@supabase/supabase-js`. Reason: official Next.js App Router cookie factories. Alternative rejected: a single `supabase-js` client in both environments, which does not handle SSR cookies.
  - `/health` treats PostgREST `PGRST205` (table not in schema cache) as a successful connection, because Stage 0 has no schema. A raw `GET /rest/v1/` returns 401 with the project's `sb_publishable_` / `sb_secret_` keys.
  - Keepalive pings `/auth/v1/health` with the publishable key for the same reason.
  - Added `.vercelignore` after a CLI deploy attempted to upload local datasets (~5.5 GB). Git already ignored `/data`; this stops Vercel CLI from packing it.
  - Set `turbopack.root` in `next.config.ts` so a lockfile under the user home directory is not treated as the workspace root.
- **Not done / deferred:** No database schema, no ingest, no auth, no maps, no `/field` `/admin` `/office` routes, no `lib/supabase/types.ts`. Did not create or overwrite the four `.env.local` values. Did not touch `data/raw/`.
- **Follow-ups:** Daily keepalive cron is `17 4 * * *`. Production URL is `https://nakolabs-d2d.vercel.app`.

---

### Stage 01 — Data ingest
- **Date:** 2026-09-12
- **Model:** Cursor Grok 4.6
- **Built:** PostGIS/pgcrypto extensions; `properties` and `nccz_zones` (EPSG:4326, GiST, RLS default-deny); streaming OS Open UPRN ingest filtered to the Bristol bbox; NCCZ GeoJSON ingest path with 27700→4326 reprojection; `is_nccz` recomputed at ingest via `apply_nccz_flags()`.
- **Acceptance:**
  - Bristol UPRN count is within a plausible range and spot-checked against a known postcode: **PASS** (424,952 rows; 240 UPRNs in a box around Temple Meads / BS1 6QF; 1,542 around Clifton / BS8; UPRN 111278 sits on Bristol Temple Meads on OpenStreetMap)
  - All geometries are stored in 4326 regardless of source projection: **PASS** (`ST_SRID(geom) <> 4326` = 0 on `properties`; test NCCZ polygon also 4326)
  - Re-running the script changes no row counts: **PASS** (first and second ingest both 424,952)
  - At least one property correctly flags `is_nccz = true`, verified by eye on a map: **PASS** (mechanism test: 13 properties including UPRN 111278 at Temple Meads flipped to true after a test polygon + re-ingest; test row then deleted)
  - Every geometry is valid (`ST_IsValid`) and in SRID 4326: **PASS** (invalid = 0, not_4326 = 0)
- **Deviations from brief:**
  - Added `tsx` (dev). Reason: run TypeScript ingest scripts. Alternative rejected: Node native type-stripping, which fights this repo's CJS `package.json`.
  - Added `proj4` (dev). Reason: reproject NCCZ from EPSG:27700 at ingest. Alternative rejected: shelling out to `ogr2ogr`, which is not guaranteed installed.
  - Added `upsert_properties`, `insert_nccz_zone`, and `apply_nccz_flags` RPCs (service_role only) so ingest constructs geometry in PostGIS as 4326. Alternative rejected: posting GeoJSON through PostgREST table insert, which is less explicit about SRID.
  - RLS enabled with no policies (default deny). Role policies wait for Stage 2 `profiles`. Anon JWT: SELECT count 0, INSERT denied. Canvasser JWT not tested — auth does not exist yet.
  - Left `nccz_zones` empty instead of loading two or three hand-drawn polygons, per this session's instruction. Mechanism proven with one test polygon, then cleared.
  - OS Open UPRN has no postcode column; `properties.postcode` is null for every row. Spot-check used coordinates of a known postcode area, not the column.
- **Not done / deferred:** Real Bristol NCCZ extract (council email still pending). Stage 1b roads. Stage 2 schema/role policies. App footer attribution line from Section 13 (no map UI yet; recorded as follow-up). Did not fabricate NCCZ polygons.
- **Follow-ups:** Load `data/raw/bristol-nccz.geojson` through `npm run ingest:nccz` when the council file arrives — no code change. Put the Section 13 attribution line on the first UI that renders OS/OSM data. `nccz_zones` row count is 0; `properties` row count is 424,952.

---

### Stage 02 — Full schema and RLS
- **Date:** 2026-09-12
- **Model:** Claude Fable 5.1 (Cursor)
- **Built:** `supabase/migrations/003_core.sql`, applied to the linked project (remote migration list now `001`,`002`,`003`). Seven tables: `profiles`, `territories`, `assignments`, `assignment_members`, `knock_events`, `leads`, `property_observations`. GiST on `territories.geom` and `assignments.route_geom`; B-trees on `assignments.work_date`, `assignment_members.canvasser_id`, `knock_events(assignment_id|uprn|canvasser_id)`, `leads(canvasser_id|uprn|status)`, `property_observations(uprn|canvasser_id)`. Two SECURITY DEFINER helpers (`app_role()`, `is_assignment_member(uuid)`; EXECUTE for `authenticated` only). Two BEFORE triggers (`assignment_members_max_three`, `leads_guard_status`). RLS enabled on all seven; 25 policies total including new SELECT-for-`authenticated` policies on `properties` and `nccz_zones`. Grants: `revoke all from anon, authenticated` on all nine tables first, then the minimum back to `authenticated` — `profiles` SELECT; `territories`/`assignments`/`assignment_members` SELECT+INSERT+UPDATE+DELETE (row-filtered by RLS); `knock_events` and `property_observations` SELECT+INSERT; `leads` SELECT, INSERT on 8 canvasser columns (`id, client_event_id, knock_event_id, uprn, canvasser_id, booked_for, is_immediate, notes`), UPDATE on 4 office columns (`status, status_set_at, status_set_by, booked_for`); `properties`/`nccz_zones` SELECT. `lib/supabase/types.ts` regenerated (+346 lines, no deletions).
- **Acceptance:**
  Harness: one SQL transaction per group as `postgres` (BYPASSRLS), fixtures inserted, each case run inside its own exception-handled sub-block after `set_config('role', 'authenticated'|'anon'|'service_role', true)` and `set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true)`, results written to a temp table and selected before `rollback`. Fixtures: six `auth.users` + `profiles` — canvassers A, B, C, D; office O; **admin M** (the fourth fixture role requested; every admin-scoped case below ran as M, not assumed); one territory; two assignments (A and B members of the first, second empty); four knock events (two each for A and B); one or two leads. 70 cases, 70 passed, 0 failed. All fixture rows rolled back (post-run counts: `auth.users` 0, all seven new tables 0, `properties` 424,952).
  - Every table reports `rowsecurity = true`: **PASS** — `select tablename, rowsecurity from pg_tables where schemaname='public'` → all nine project tables `true` (`assignment_members, assignments, knock_events, leads, nccz_zones, profiles, properties, property_observations, territories`). `spatial_ref_sys` is `false`; it is the PostGIS extension's own table, owned by `supabase_admin`, not created by this project and not alterable by `postgres`. Reported separately, not counted.
  - A canvasser JWT cannot read another canvasser's knock events — tested: **PASS**
    - as A `select * from knock_events` → `rows=2 all_A=true ids=ce-a1,ce-a2`
    - as B `select * from knock_events` → `rows=2 all_B=true ids=ce-b1,ce-b2`
    - as A `select ... where canvasser_id = B` → `rows=0`
    - as admin M `select * from knock_events` → `rows=4 ids=ce-a1,ce-a2,ce-b1,ce-b2` (allowed case)
    - as office O → `rows=0` (no policy); as anon → `42501 permission denied for table knock_events`
    - as A insert own knock on own assignment → inserted (allowed); as A insert with `canvasser_id = B` → `42501 new row violates row-level security policy`; as A insert on an assignment A is not a member of → `42501` RLS violation; as A update own knock → `42501 permission denied` (immutable log).
  - A canvasser JWT cannot update `leads.status`: **PASS**
    - as A `update leads set status='sale' where id=L` → `rows_updated=0 status_after=pending`
    - as A `insert into leads (..., status) values (..., 'sale')` → `42501 permission denied for table leads` (column grant)
    - as A insert without `status` against own knock event → inserted, `status=pending` (allowed case)
    - as A insert against B's knock event → `42501` RLS violation
    - as A `update leads set notes` → `42501 permission denied`; as A `delete from leads` → `42501 permission denied`
    - as office O `update status='sale', status_set_at, status_set_by` → `rows_updated=1 status_after=sale` (allowed); as O `update booked_for` → `rows_updated=1` (allowed)
    - as O `update notes` → `42501 permission denied`; as O `update crm_ref` → `42501 permission denied`
    - as admin M `update status` → `rows_updated=0` (no admin UPDATE policy, per brief: office and service role only)
    - as `service_role` `update status, crm_ref, crm_last_synced_at` → `rows_updated=1`
    - trigger unit tests as `postgres` (bypasses RLS and grants) with A's claims: `update status='sale'` → `42501 Canvassers cannot change lead status`; `insert ... status='sale'` → `42501 Canvassers cannot set lead status`; with O's claims `update status` → `rows_updated=1` (trigger no-op for office).
  - A lead moved to `re_app` remains visible in the pending pipeline: **PASS**
    - as O `update leads set status='re_app', ... where id=L` → `rows_updated=1`
    - as A `select ... where status in ('pending','re_app') and id=L` → `rows=1 status=re_app`
    - as O `select ... where status in ('pending','re_app')` → `rows=2 statuses=pending,re_app`; as admin M → `rows=2`
    - as A `select count(*) from leads` → `rows=1` (does not see B's lead)
    - as `service_role`, all eight statuses cycled through the check constraint → `pending:ok re_app:ok sale:ok pm:ok blowout:ok utc:ok btc:ok cancelled:ok`; `status='bogus'` → `23514 violates check constraint "leads_status_check"`.
  - Inserting a fourth `assignment_members` row fails (third succeeds, per your amendment to 1–3): **PASS**
    - as admin M insert members 1, 2, 3 into the empty assignment → `count=3`
    - as M insert 4th → `23514 A team is one to three canvassers`; count after → `3`
    - as `service_role` insert 4th → `23514 A team is one to three canvassers` (trigger holds when RLS is bypassed)
    - as canvasser A insert a member → `42501` RLS violation.
  - `lib/supabase/types.ts` regenerated and compiles: **PASS** — `supabase gen types typescript --project-id xerxsaptwpvhkkpyvkfi --schema public`; file contains all nine tables plus `app_role`, `is_assignment_member` and the three Stage 1 RPCs; `npx tsc --noEmit` exit 0.
  - Additional policy-matrix verification (not in the brief's checklist, all with actual output):
    - `properties`/`nccz_zones`: as A `select count(*) from properties` → `424952`; as O `nccz_zones` → `0` (no error); as anon both → `42501 permission denied`; as admin M insert into `properties` → `42501`; as A update → `42501`.
    - `profiles`: as A → `rows=1 names=Canvasser A`; as O → `rows=1`; as admin M → `rows=6`; as M update → `42501 permission denied`; as A `update own role to admin` → `42501 permission denied`; C deactivated (`active=false`) then `select territories` → `rows=0` (`app_role()` null).
    - `territories`: as A and O select → `rows=1`; as M insert + update → `inserted; updated=1`; as A insert → `42501` RLS; as O update → `rows_updated=0`; as A delete → `rows_deleted=0`.
    - `assignments`/`assignment_members`: as A select assignments → `rows=2` (member of both by then); as D (no memberships) → `0`; as O → `0`; as M → `2`; as A update own assignment → `0`; as M → `1`; as B select members of the shared assignment → `rows=2 members=A,B`; as D → `0`.
    - `property_observations`: as A insert own → inserted; as A insert as B → `42501` RLS; as A select → `rows=0`; as M select → `rows=1`; as M update → `42501 permission denied`.
    - helpers: as anon `select app_role()` → `42501 permission denied for function app_role`; as O → `office`.
- **Deviations from brief:**
  - `leads` gained `client_event_id text unique not null` and `unique (knock_event_id)`. Reason: every client-originated write must carry an idempotency key (Section 3, rule 4) and the brief's `leads` DDL had none; one knock event produces at most one lead. Column comment records the Stage 8 contract (below).
  - Team size trigger rejects the **fourth** member, not the third. Brief text says "1 or 2"; you amended the project rule to 1 to 3 (`00-core.mdc`, `AGENTS.md`). Migration comment updated to match.
  - Extra B-tree indexes beyond the brief: `assignments.work_date`, `assignments.route_geom` (GiST), `assignment_members.canvasser_id`, `knock_events.canvasser_id`, `leads(canvasser_id, uprn, status)`, `property_observations(uprn, canvasser_id)`. All are RLS filter or join columns.
  - `app_role()` returns null for an inactive profile, so deactivating a user removes all access without deleting rows.
  - Both trigger functions are SECURITY DEFINER (plan said only the two helpers). Reason: the member count must see every row regardless of the caller's RLS view, and `leads_guard_status()` must be able to call `app_role()` when fired by `service_role`, which has no EXECUTE on it. Alternative rejected: granting EXECUTE on the helpers to `service_role`, which widens the RPC surface for no benefit.
  - `properties`/`nccz_zones` also had `authenticated` write privileges revoked (plan only said revoke `anon`). RLS already denied writes; the revoke makes it a privilege error rather than a silent zero-row result.
  - Additional explicit role checks: `knock_events`, `leads` and `property_observations` INSERT policies require `app_role() = 'canvasser'` as well as `canvasser_id = auth.uid()`. Brief says "canvasser inserts"; this makes it literal.
  - Fixtures used six users (A, B, C, D, O, M) rather than the plan's three, so the team-size and admin cases ran against real rows.
  - Security advisor flags `app_role()` and `is_assignment_member()` as SECURITY DEFINER callable by `authenticated` over RPC. Intentional: RLS policies evaluate as the querying role and need EXECUTE; both return only the caller's own role/membership. Not a data leak. `anon` cannot call either (tested).
- **Not done / deferred:** No `route_steps`, `amenities`, `territory_visits`, `appointment_slots`, `crm_sync_runs`, `crm_status_map`. No auth flow, no profile-creation trigger (Stage 3), no app routes, no coverage table or view. `001` and `002` untouched. Did not enable RLS on `spatial_ref_sys` (PostGIS-owned; would need `supabase_admin`). Did not move the `postgis` extension out of `public` (advisor WARN, pre-existing from Stage 1). Office has no read on `knock_events`, `assignments` or other users' `profiles` — the brief does not grant it; a later stage adds what it needs. Admin has no UPDATE on `leads` — brief limits status settlement to office and service role.
- **Follow-ups:**
  - **Stage 8:** the field logger generates **one `client_event_id` per door-visit action** and uses it for both the `knock_events` insert and, when the outcome is `lead`, the `leads` insert. Same id, two rows. The column comment on `leads.client_event_id` says the same.
  - Stage 3 needs an `auth.users` → `profiles` trigger (or service-role insert); no JWT role can write `profiles`.
  - Generated `Insert`/`Update` types for `leads` still list `status`, `crm_ref` etc. as optional — types do not reflect column grants. A canvasser client sending `status` gets `42501` at runtime. Stage 8 queue should never include it.
  - `assignment_members_max_three` also fires on `update of assignment_id` (moving a member), not just insert.
  - Test harness pattern (fixtures + `pg_temp.become()` + per-case sub-blocks + `rollback`) is reusable for every later RLS change.
