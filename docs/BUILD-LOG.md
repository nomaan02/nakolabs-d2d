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

---

### Stage 03 — Auth and role routing
- **Date:** 2026-09-12
- **Model:** Cursor Grok 4.6
- **Built:** Migration `004_profile_on_signup.sql` — `handle_new_user()` SECURITY DEFINER trigger on `auth.users` inserts `profiles` (`role=canvasser`, `active=true`, `full_name` from `raw_user_meta_data`). Email/password login and signup (no role selector). Next.js middleware reads the session with `getUser()` then `profiles`, and is the only route-group gate. Route groups: `app/(admin)/admin`, `app/(office)/office`, `app/(field)/field`. Session with no usable profile goes to `/account-pending`.
- **Policies:** none new (no new table). `handle_new_user` EXECUTE granted to `supabase_auth_admin`; revoked from `public`, `anon`, `authenticated`. Default privileges still give EXECUTE to `postgres` and `service_role`. JWT roles still have no INSERT/UPDATE on `profiles`.
- **Acceptance:**
  Harness: three confirmed users created via Auth admin API (trigger wrote canvasser rows; office/admin then updated with service role). Sessions attached as `@supabase/ssr` cookies. `GET` with `redirect: manual` against `http://localhost:3000`. Users deleted afterwards (`auth.users` 0, `profiles` 0). SQL trigger test in a rolled-back transaction: named insert → `role=canvasser active=true name=Trigger Test`; unnamed → `name=<null>`; canvasser JWT `select` own row `rows=1`; canvasser JWT `insert`/`update role` → `42501 permission denied for table profiles`; anon insert → `42501`.
  - Each role lands on its own route group and cannot reach the other two: **PASS**
    - canvasser `GET /field` → `200` title=Field; `/admin` → `307` loc=/field; `/office` → `307` loc=/field
    - office `GET /office` → `200` title=Office; `/admin` → `307` loc=/office; `/field` → `307` loc=/office
    - admin `GET /admin` → `200` title=Admin; `/office` → `307` loc=/admin; `/field` → `307` loc=/admin
    - Browser (canvasser session): signed in at `/login` landed on `/field` as "UI Canvasser"; visiting `/admin` and `/office` both ended on `/field` (never rendered Admin/Office).
  - Enforcement is server-side; removing the client guard does not grant access: **PASS** — there is no client-side role guard. `app/(admin)/admin/page.tsx`, `app/(office)/office/page.tsx` and `app/(field)/field/page.tsx` render for whoever reaches them. Wrong-role requests never reach the page (`307` from `middleware.ts` / `lib/supabase/middleware.ts` before RSC).
  - Signed-out access to any protected route redirects to login: **PASS**
    - signed-out `GET /admin|/office|/field|/account-pending` → `307` loc=/login
    - Browser: `/admin` and `/office` while signed out both showed the Sign in page.
- **Missing-profile choice:** session present, no `profiles` row (or `active=false`) is sent to `/account-pending`, not to a role home and not treated as signed out. Copy: "Your account is still being set up. Refresh this page in a moment." plus Refresh and Sign out. Inactive uses the same route: "This account is inactive. Please speak to an administrator." Harness: profile row deleted, then `GET /field` → `307` loc=/account-pending; `GET /account-pending` → `200` title="Setting up your account".
- **Deviations from brief:**
  - Remote migration version is `20260912184457` / name `004_profile_on_signup` (MCP `apply_migration` timestamps). Local file kept as `004_profile_on_signup.sql` to match `001`–`003`. `npx supabase db push --linked` failed (`LegacyProjectNotLinkedError`).
  - `/health` now probes `profiles` and treats `42501` as connected. Reason: `createClient` is typed to `Database`, so the Stage 0 `__connection_probe` table name no longer type-checks. Anon still cannot read `profiles`.
  - Hosted GoTrue rejects `@example.com` on public `signUp` (`email_address_invalid`). Form maps that to "That email address is not accepted. Use a real inbox." Admin `createUser` is unaffected. Auth logs also showed `user_confirmation_requested`; if confirmations stay on, `signUp` with no session redirects to `/login?notice=created` rather than `/field`.
- **Not done / deferred:** Password reset, email-verification UI, user-management / role-editing UI, Stage 4 maps. `001`–`003` untouched. No coverage table. No second sync path.
- **Follow-ups:** Promote office/admin with a service-role or SQL write — signup cannot do it. If demo signups should skip confirmation, turn Confirm email off in the Auth dashboard (not built as UI).

---

### Stage 04 — Prop drawing and door count
- **Date:** 2026-09-12
- **Model:** Claude Opus 5 (Cursor)
- **Built:** Three migrations, not one. `005_count_knockable.sql` — `count_knockable(poly geometry)` returning `(total, knockable, excluded)`. `006_properties_in_polygon.sql` — `assert_prop_polygon(poly)` (shared validation, extracted so the two RPCs cannot drift) and `properties_in_polygon(poly, cap default 3000)`. `007_prop_doors_geojson.sql` — recreates `properties_in_polygon` to return one `jsonb` FeatureCollection instead of a row set (see deviations). All three SECURITY INVOKER, `stable`, `set search_path = public`. Admin map at `/admin`: MapLibre GL + MapTiler `dataviz-light`, Terra Draw polygon and select modes, door dots as a GeoJSON source with one data-driven circle layer, door tally with a 40–150 gauge, oversize warning, truncation notice, and a `saveProp` Server Action writing `territories`. Client wrappers `lib/geo/{prop-polygon,rpc-error,count-knockable,properties-in-polygon,prop-warnings}.ts`. Acceptance harness `scripts/verify-stage-4.ts` (`npm run verify:stage4`).
- **Privileges (explicit, following 003):** all three functions `revoke all ... from public, anon, authenticated, service_role` then `grant execute ... to authenticated`. Final ACL on each is `postgres=X/postgres | authenticated=X/postgres` — `anon` and `service_role` have none. Being `authenticated` is not sufficient: each function body raises `42501` / `hint=not_admin` unless `app_role() = 'admin'`. Two gates, deliberately: the grant keeps `anon` and `service_role` out at the privilege layer, the body keeps canvassers and office out at the business layer. `service_role` was excluded because nothing server-side counts doors; if a later stage needs it, grant it then.
- **Acceptance:**
  Harness: three throwaway confirmed users (admin, office, canvasser) created via the Auth admin API, signed in over HTTPS, every call made with a real `access_token`. Nothing runs as `postgres` and nothing bypasses RLS. Raw `fetch` against `/rest/v1/rpc/...` so the HTTP status is visible rather than swallowed by `supabase-js`. Users deleted and `nccz_zones` returned to empty afterwards (`final: nccz_zones=0 is_nccz=true 0 properties=424952`). Browser checks ran as the real signed-in admin (`nomaanakram4@gmail.com`) at `localhost:3001/admin`.
  - A polygon drawn around a known street returns a count matching a manual check: **PASS** — box over one terrace on the south side of Monmouth Road, Bishopston. UI read `KNOCKABLE DOORS 18 / TOTAL 18 / EXCLUDED 0`; saved as a territory, then counted a second way that never touches the RPC — `select count(*) from properties p, territories t where st_within(p.geom, t.geom)` → `18`. Harness `street` ring → `{"total":69,"knockable":69,"excluded":0}`, dot RPC `features=69 unique uprns=69`. **Caveat, found while checking by eye:** that prop holds 18 doors at only 17 distinct coordinates (`count(*)=18`, `count(distinct st_astext(geom))=17`) — two UPRNs share a point, so eye-counting the dots gives 17. The dots are a sanity check, not a countable source; the number always comes from Postgres.
  - A ~300-door polygon triggers the size warning without preventing save: **PASS** — harness `doors_300` → 296 doors, warning `"296 knockable doors is above the 150 a shift usually covers. Save it anyway if you know something the boundary does not."`. In the browser a 349-door prop showed the warning and saved; so did a 40,513-door prop. `propWarnings` returns advisory text only and is never consulted by `saveProp` — there is no code path where a warning blocks the button.
  - NCCZ properties appear in `excluded`, never in `knockable`: **PASS** — `nccz_zones` was genuinely empty first (`before: nccz_zones=0 properties.is_nccz=true count=0`, count `69/69/0`). Inserted one temporary zone inside the street ring via `insert_nccz_zone`, ran `apply_nccz_flags()` → 32 flagged table-wide. Count became `{"total":69,"knockable":37,"excluded":32}`. Cross-checked against a number computed a different way: the test zone sits wholly inside the prop, so the table-wide flag count must equal the prop's `excluded` — `flagged==excluded true`, `knockable+excluded=69` = total, `knockable fell by 32`. Dot RPC in the same state: `features=69 is_nccz=true 32 is_nccz=false 37`. Also verified by eye in the browser on a separate 60-door prop: 30 solid blue, 30 hollow oxide-ringed. Zone deleted and flags recomputed → `after: nccz_zones=0 properties.is_nccz=true count=0`, count back to `69/69/0`.
  - A self-intersecting polygon is rejected with a clear message, not a 500: **PASS** — bowtie ring, `HTTP 400`, `{"code":"22023","hint":"invalid_geometry","details":"Self-intersection[-2.59375 51.4789]","message":"That polygon crosses itself. Redraw the boundary without crossing lines."}`. Verified in the browser too, drawing a real bowtie with Terra Draw (which allowed the crossing — it does not validate): panel showed `NOT COUNTED`, the message, and `Self-intersection[-2.59375275 51.4794141]`; `HTTP 400` captured from the app's own request. No dots drawn, no save form. `properties_in_polygon` was never called, confirming the dot fetch only runs after the count succeeds and the shape is not validated twice.
  - A ~2,000-door prop counts in under a second: **PASS** — 1,830 doors: `32ms 30ms 32ms`. 2,353 doors: `30ms 30ms 30ms` (three consecutive runs each, full round trip from Node). Browser round trips are slower because of the extra hop: 1,268 doors `281ms` cold then `193ms`/`191ms` warm; 5,915 doors `811ms` cold, `508ms` warm. All under a second. Postgres-side execution for 5,915 doors was ~7.9ms — the time is network, not the query.
  - Counting happens in Postgres, never on the client: **PASS** — `count_knockable` returns three integers (44–48 byte responses). No code path selects from `properties` in the browser. `properties_in_polygon` returns geometry for drawing only and is capped; the displayed number never comes from it.
  - The dot layer never silently disagrees with the count: **PASS** — the tally renders the truncation line whenever `shown < count.total`, so a failed or capped dot fetch reads `"Map is showing 0 of 1,268 doors"` rather than looking complete. Browser, 40,513-door prop: `"Map is showing 3,000 of 40,513 doors. The count above is the full figure."` Cap truncation is stable — cap 100 twice on the same polygon returned the identical UPRN set (`identical set on re-run true`).
  - Only an admin can call either RPC: **PASS** — canvasser token `HTTP 403` `hint=not_admin`; office token `HTTP 403` `hint=not_admin`; anon key with no session `HTTP 401` `permission denied for function count_knockable`; service-role key `HTTP 401`, and through `supabase-js` `42501 permission denied for function count_knockable`. Same five results for `properties_in_polygon`.
  - Other malformed input is a structured 400, not an exception: **PASS** except one case, below — `null` → `hint=missing_polygon`; `MULTIPOLYGON` → `hint=geometry_type`, `details="Received MULTIPOLYGON."`; `SRID=27700` → `hint=srid`, `details="Received SRID 27700."`; `POLYGON EMPTY` → `hint=empty_polygon`; `cap 0` and `cap 20000` → `hint=cap_out_of_range`. A two-corner ring is rejected client-side with no network call (`too_few_points`).
  - `SUPABASE_SERVICE_ROLE_KEY` absent from the client bundle: **PASS** — production `next build`, then searched all 29 files under `.next/static` for the key's value and its variable name: zero hits. One apparent match was `@supabase/supabase-js`'s own prefix check `startsWith("sb_publishable_")||startsWith("sb_secret_")`, a library literal, not the value.
  - Dot layer performance, stated per the map-layer skill: **PASS with a caveat about the device.** 3,000 points (the cap), one GeoJSON source and one circle layer, measured on the development machine — Windows 11 desktop, Chrome via the Cursor browser — with CDP CPU throttling at 4x. 940 frames sampled during a zoom: median 16.7ms, p95 16.8ms, p99 33.3ms, worst 83.4ms, 20 frames (2.1%) over 33ms. So 60fps with occasional single dropped frames. **No mid-range phone was available; 4x CPU throttling is a proxy for one, not a substitute.** A real device test is a follow-up. An initial reading showed repeated ~1000ms frames; those were Chrome clamping `requestAnimationFrame` to 1Hz because the automated tab was unfocused (values were exactly 1000/1017ms, `document.hasFocus() === false`) — a measurement artefact, excluded.
  - A-road crossing warning: **NOT VERIFIED — deliberately not built.** Out of scope this stage; see below.
- **Deviations from brief:**
  - **Three migrations instead of one.** `005` is the brief's `count_knockable`. `006` adds the dot RPC requested mid-session. `007` exists only because `006` was wrong (below). Kept as three append-only files rather than rewriting `005`.
  - **`properties_in_polygon` returns `jsonb`, not a table.** PostgREST's `db-max-rows` is 1000 and it is a hard ceiling for row-returning functions — a `Range: 0-2999` header does not lift it (verified: with and without the header, both `HTTP 200 features=2353 content-range=0-0/*`). A 3,000-dot cap is therefore impossible as a row set. `007` returns one `jsonb` FeatureCollection, which is a single value and not subject to the row limit, and is also the exact shape a MapLibre GeoJSON source wants. Alternative rejected: raising `db-max-rows` project-wide, which would loosen a sensible default for every table to suit one function.
  - **Garbage WKT is a 500, not a 400.** `"this is not a polygon"` → `HTTP 500`, `XX000 parse error - invalid geometry`. PostGIS's input parser raises this while coercing the argument, before the function body runs, so `assert_prop_polygon` never sees it and cannot re-raise it as class 22. PostgREST maps `XX000` to 500. Not fixed because the fix is worse than the bug: the argument would have to be `text` and parsed inside the function, giving up the type signature. The app cannot produce this input — `ringToEwkt` builds the WKT from numbers. Recorded as a known edge rather than papered over.
  - **The dot cap is `order by uprn limit cap`, so a truncated render is not spatially representative.** Visible on the 40,513-door prop: the 3,000 drawn dots clustered in the north-west of the polygon because the lowest UPRNs happen to sit there, leaving most of the prop looking empty. The count and the truncation notice are both correct, but the picture is misleading at that size. Acceptable here because a real prop is 40–150 doors and never truncates. Follow-up below.
  - **Added three runtime dependencies.** `maplibre-gl` ^6.9.0 — the brief's map library. `terra-draw` ^1.33.0 and `terra-draw-maplibre-gl-adapter` ^1.4.1 — the brief's drawing library plus the adapter it needs for MapLibre. Fonts via `next/font/google` (no new package): Bricolage Grotesque, Martian Mono, Instrument Sans.
  - **MapLibre's web worker is copied into `public/` and set explicitly.** Turbopack rewrites `import.meta.url` to an empty string inside `maplibre-gl`, so the library called `new Worker("")`, the worker never booted, and tiles were fetched but never parsed — a blank plate with no console error. `scripts/copy-maplibre-worker.ts` copies `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` to `public/maplibre/` (`predev` and `prebuild` hooks), and `prop-drawer.tsx` calls `setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")`. `/public/maplibre/` is gitignored as build output. This is a bundler workaround, not a design choice — revisit when Turbopack handles worker URLs.
  - **Map view is remembered in `sessionStorage`, not the URL.** MapLibre's `hash: true` was tried first and reverted: it rewrites `location` on every pan, which the App Router treats as navigation and which remounted the map mid-load (eight `style.json` fetches instead of one). `VIEW_KEY = "prop-drawer-view"`, written on `moveend`.
  - **Dots are colour-differentiated, which `00-core.mdc` forbids — but only in `/field`.** Knockable dots are solid Bristol blue; NCCZ dots are hollow with an oxide ring, so they differ by shape as well as colour and do not depend on colour vision. `/admin` only. No scoring or ranking anywhere.
  - **Recount is debounced 500ms on vertex drag and skipped when the ring is unchanged.** Terra Draw fires `update` on selection as well as on edit, so closing a ring then selecting it produced two identical counts against 424,952 rows. A `measuredRing` ref holds the last measured ring's signature and short-circuits the repeat.
  - **`app_role() is distinct from 'admin'` raises rather than returning zero.** An admin-only tool that silently answers "0 doors" for a canvasser is worse than an error.
  - The account promotion asked for in this session: `nomaanakram4@gmail.com` was set to `role='admin'` and its email confirmed, so the admin map could be used as a real JWT session rather than a throwaway fixture.
- **Not done / deferred:**
  - **The A-road crossing warning is not built, and is not stubbed.** It needs road classification that does not exist — no `road_segments` table, no `highway` column, and Stage 1b has not run. A check that always answers "no A-road crossed" is indistinguishable from a passing check and would stay quietly wrong after Stage 1b lands. Recorded as a commented `TODO` in `lib/geo/prop-warnings.ts` naming what it needs and how to test it (a prop drawn across the A38 Gloucester Road).
  - No allocation, no assignments, no route generation, no coverage — all Stage 5 onward. No roads. No auth changes beyond the one role promotion. `001`–`004` untouched. No coverage table. No second sync path. Nothing written to `knock_events`.
  - No real-device performance test (see acceptance caveat).
- **Follow-ups:**
  - Four test props remain in `territories`, all named `... (stage 4 check)`: `Monmouth Road`, `Oversize warning`, `Wide prop` (5,915 doors), `Manual check terrace` (18 doors). Left in place as visible evidence; delete them before Stage 5 allocation runs against real props.
  - If a truncated render ever needs to be representative, order the cap by something spatial (`ST_Distance` from the polygon centroid, or a hash) rather than `uprn`. Not worth it while props stay at 40–150 doors.
  - Add the A-road warning as a second `PropWarning` code once `road_segments` exists. The warning list is already an array, so nothing else changes.
  - Both RPCs deliberately have no `service_role` EXECUTE. Grant it if a server-side caller ever needs to count doors.
  - Do not run `next build` while `next dev` is running — the production build wipes `.next/static/development` and kills the dev server. Cost a restart this session.

---

### Stage 05 — Allocation and rotation
- **Date:** 2026-09-14
- **Model:** Cursor Grok 4.6
- **Built:** `allocate_prop(territory_id, work_date, canvasser_ids)` — one SECURITY INVOKER function that reads `territories.visit_count` (does not increment it), computes rotation, freezes knockable UPRNs with the interim geometric angular sweep, and inserts `assignments` plus 1–3 `assignment_members` in a single statement. Migrations `008_allocate_prop.sql` and `009_allocate_prop_numeric_mod.sql` (008's `mod(float8,float8)` does not exist in Postgres). Admin UI at `/admin/allocate`. Wrappers `lib/geo/allocate-prop.ts`, `lib/geo/rotation.ts`, server action `lib/props/allocate.ts`. Types regenerated. Harness `npm run verify:stage5`.
- **Policies:** no new table, so no new RLS. Function ACL: `revoke all from public, anon, authenticated, service_role` then `grant execute to authenticated` only. Final ACL `postgres=X/postgres | authenticated=X/postgres`. Admin is enforced in the body (`app_role() = 'admin'`), same pattern as `count_knockable`. Team size and one-allocation-per-prop-per-date are Stage 2's trigger and unique constraint, re-raised with hint tokens `team_too_large` / `already_allocated`.
- **Acceptance:**
  Harness: six throwaway confirmed users (admin, office, four canvassers), a Bishopston street-ring territory (4 vertices, 69 knockable doors), every RPC call made with a real `access_token`. `visit_count` was written only by the service role *between* allocations to simulate Stage 12b close. Users and the test territory deleted afterwards.
  - Allocating the same prop three times yields three different entry vertices and alternating directions: **PASS**
    - visit_count 0 → n=1 vertex=**1** dir=**ccw** slot=mid doors=69; visit_count stayed 0
    - visit_count 1 → n=2 vertex=**2** dir=**cw** slot=late doors=69; visit_count stayed 1
    - visit_count 2 → n=3 vertex=**3** dir=**ccw** slot=early doors=69; visit_count stayed 2
    - entry vertices `1, 2, 3`; directions `ccw, cw, ccw`
  - Rotation is reproducible: the same `visit_number` always gives the same entry vertex: **PASS** — reset visit_count to 0, allocate a fourth date → n=1 vertex=1 dir=ccw slot=mid, identical to the first
  - `uprn_snapshot` excludes NCCZ and follows the angular sweep from the entry vertex, not row order: **PASS** — 69 knockable, 0 NCCZ, matches an independent JS sweep, first snapshot UPRN 48895 vs order-by-uprn 47584, sweep monotonic. With a temporary NCCZ zone: 32 excluded, snapshot 37, overlap with excluded = 0
  - Two allocations for the same prop on the same date are rejected by the unique constraint: **PASS** — wrapper `already_allocated`; raw HTTP 409 `23505`; rows for that date remained 1
  - Editing the prop polygon does not alter an existing snapshot: **PASS** — geom replaced with a wider ring; snapshot still 69 doors, byte-identical
  - Allocating with three canvassers succeeds; a fourth is rejected by Stage 2's trigger: **PASS** — trio members=3; four ids → HTTP 400 `team_too_large` `A team is one to three canvassers.`; assignments count unchanged; rows on that date = 0 (no orphaned assignment)
  - Browser (signed-in admin at `/admin/allocate`): picked Monmouth Road, 16 Sept, one canvasser → "Visit 1 starts at vertex 1, counter-clockwise, mid slot. 60 knockable doors frozen." DB row matched; `territories.visit_count` stayed 0. Draw page shows Draw/Allocate nav and per-prop Allocate links.
- **Deviations from brief:**
  - Prompt said "adds 006"; Stage 4 already used 006 and 007, so this is **008**. 009 exists only because 008's `mod(float8, float8)` is not a Postgres function — `mod()` is integer/numeric. 008 left applied and unedited.
  - `visit_count` is not incremented here, so the three-rotation test bumps it between calls as Stage 12b will. Two allocations without that bump both get visit_number 1 (verified by the reproducibility case).
  - Empty team is rejected in the function *before* insert. Stage 2's trigger only rejects a fourth member; without this check a zero-length call would leave the orphaned assignment the stage forbids.
  - Admin UI is `/admin/allocate`, not folded into the drawing map. Same worksheet chrome.
- **Not done / deferred:** Stage 5b route traversal / `route_geom` / claiming. `territories.visit_count` increment (Stage 12b). Stages 6 onward. No coverage table. No scoring in `/field`. 001–007 untouched.
- **Follow-ups:**
  - Stage 12b must increment `visit_count` exactly once on close, or successive allocations of the same prop will keep starting at the same vertex.
  - Stage 5b replaces the labelled placeholder `-- interim geometric ordering, replaced by Stage 5b's route traversal`. Existing `uprn_snapshot` rows stay frozen.
  - `allocate_prop` has no `service_role` EXECUTE. Grant it if a server-side caller ever needs to allocate.

---

### Stage 06 — Field prop view and offline cache
- **Date:** 2026-09-14
- **Model:** Cursor Grok 4.6
- **Built:** Migration `010_todays_assignment.sql` — `todays_assignment()` SECURITY INVOKER, returns one jsonb document (header + `uprn_snapshot` joined to `properties.geom` in snapshot order as a FeatureCollection) or JSON null. `/field` map + list, Dexie cache of that full document keyed to assignment and canvasser. Types regenerated. Harness `npm run verify:stage6`.
- **Policies:** no new table, so no new RLS. Function ACL: `revoke all from public, anon, authenticated, service_role` then `grant execute to authenticated` only. Final ACL `postgres=X/postgres | authenticated=X/postgres`. No `app_role()` gate in the body.
- **Acceptance:**
  - Load the prop, enable airplane mode, force-quit, reopen — the prop renders from Dexie: **PASS** — canvasser JWT loaded `/field` (`Visit 1 · starting from the east · anticlockwise · mid · 69 doors`, first UPRN 48895, last 48873). Dexie `nakolabs-d2d-field` then held `{assignment_id: 05e544c1-…, work_date: 2026-09-14, door_count: 69, features: 69, compass: east}`. Blocked `*.supabase.co`, full document reload of `/field`: same header, same 69 doors, status “Showing the copy saved on this phone.” Dexie after reopen: same assignment_id, 69 features, first 48895, last 48873. **Caveat:** blocking `*supabase*` also blocked the Next.js chunk whose filename contains `supabase`, so the test blocks the API host only. A true airplane-mode reopen of the whole origin still needs an app shell (no service worker in this stage).
  - Dot order matches `uprn_snapshot` order: **PASS** — canvasser JWT HTTP 200, `feature order matches snapshot: true`, sequences `0..n-1: true`, 69 features / 69 snapshot. First UPRN 48895, last 48873. List view Door 1 = 48895 … Door 69 = 48873.
  - Tap accuracy test on a real phone, on a real terraced street, at zoom 19: **NOT VERIFIED** — needs a real phone on a real terrace. Circle radius at z19 is 16px (~32px diameter); 44px CSS on list rows is not that test.
  - Honest empty when the caller is not a member today: **PASS** — other / idle / office / admin JWT `HTTP 200 body=null` (office is null, not 42501). Idle canvasser in the browser: “No prop allocated for today.” plus “Nothing is assigned to you for today. If you should be out, speak to the person who allocates the props.”
  - Compass reuses Stage 5 centroid→entry-vertex `ST_Azimuth`: **PASS** — live assignment `entry_az=1.83139871854165` rad (`104.93°`) from `st_azimuth(st_centroid(geom), st_pointn(ring, entry+1))`; RPC `entry_compass=east`; independent octant from that azimuth `east`; match true.
  - EXECUTE authenticated, no `app_role()` gate: **PASS** — `acl={postgres=X/postgres,authenticated=X/postgres}`, `body_mentions_app_role=false`. Anon HTTP 401 `42501 permission denied for function todays_assignment`. Canvasser JWT sees only own assignment (`includes other's yesterday: false`).
  - Full RPC response cached, not the raw UPRN array: **PASS** — Dexie payload includes `doors.features[].geometry` and `properties.{uprn,sequence}` plus header fields. No `is_nccz` on features.
  - Nothing coloured, scored, or visually differentiated: **PASS** — one circle layer, `circle-color` is `--color-ink` for every door. Screenshot of Bishopston test prop: all dots the same.
- **Deviations from brief:**
  - Added `dexie` ^4.4.6. Reason: the brief's offline cache. Alternative rejected: `localStorage` (too small, no index by assignment).
  - Header uses compass (“starting from the east”), not a street name. UPRN dots have no address text (Section 3, rule 5). British “anticlockwise”, not the admin UI's “counter-clockwise”.
  - Dexie schema version 2 adds `canvasser_id` so a shared phone cannot show another canvasser's cached prop. Version 1 upgrade clears old rows.
  - RPC/network timeout (8s) and a native IndexedDB fallback if Dexie open is slow, so a blocked API cannot leave the screen on “Loading”.
  - MapTiler style fetch falls back to a plain worksheet background if tiles are unreachable; OS attribution stays on the control.
- **Not done / deferred:** Stage 5b routing. Stage 7 sync queue. Any field writes. Service worker / full-origin airplane shell. Tap-accuracy on a real terrace. 001–009 untouched. No coverage table. No scoring in `/field`.
- **Follow-ups:**
  - Tap accuracy at zoom 19 on a real terraced street is on you — do not treat CSS `min-h-11` as that test.
  - If demo-day airplane mode must survive a killed tab with no localhost either, add a service worker later; Dexie already holds the assignment document.
  - Map-layer skill: 69 points (the Bishopston street-ring fixture), measured on Windows 11 desktop Chrome via the Cursor browser. Not a mid-range phone.

> **Amended 2026-09-16.** Invariant 5 was narrowed on this date to permit read-only address labels. The original entry correctly records what shipped at the time (UPRN dots with no address text). Labels are added in Stage 1c plus the Stage 8 session, via a separate Dexie store — the snapshot shape recorded above is not altered.

---

### Stage 07 — Sync queue (session 1 of 2: queue module; service worker is the separate pass)
- **Date:** 2026-09-15
- **Model:** Claude Fable 5.1 (Cursor)
- **Built:** The only field write path, per `docs/plans/stage-7-plan.md` §1–3, 5. No migration; `supabase/migrations` and `lib/supabase/types.ts` untouched.
  - `lib/field/db.ts` version 3: `outbox` (`++seq, &client_event_id, assignment_id, canvasser_id, status, [assignment_id+seq], [status+assignment_id]`) and `sync_meta` (`key`). `assignments` unchanged, not cleared. Dexie opened with `cache: "disabled"` (see deviations).
  - `lib/sync/ops.ts`: `SyncOp` union (`knock_event` with optional paired `lead`, `property_observation`), narrow wire types (`KnockEventWrite` with device-generated `id`, `CanvasserLeadInsert` = the eight grantable columns so `status` cannot be expressed, `PropertyObservationWrite`), `validateOp` (rejects a lead whose `client_event_id` differs from its knock's, or whose `knock_event_id` is not the knock's `id`), `newClientEventId` / `newRowId` (`crypto.randomUUID`, `getRandomValues` fallback).
  - `lib/sync/classify.ts` (pure): `23505` → duplicate; `401`/`PGRST30x` → auth; status 0, abort, 408, 429, 5xx → retryable; every other 4xx → permanent. Keyed on SQLSTATE, not HTTP status, because PostgREST returns 409 for `23503` as well as `23505`.
  - `lib/sync/backoff.ts` (pure): full jitter, base 2 s, cap 5 min.
  - `lib/sync/queue.ts`: `enqueue` (check-then-add in one rw transaction; same id → `already_queued`), `flush(reason)` under a Web Lock `d2d-outbox-flush` with `ifAvailable` and one queued re-run behind a holder (in-memory flag where Web Locks is absent), `getSession` → held rows for other canvassers, per-assignment groups in `seq` order, ok/duplicate → `synced` + `sync_meta.last_sync_at`, permanent → `failed` and continue, auth → `auth_required` and stop, retryable → head-of-line block for that assignment and backoff. External triggers reset the backoff counter; the 30 s timer never piles onto a scheduled retry. `sendOp` exported for the harness: knock insert → (lead insert), each with its own 10 s `AbortController`, `Prefer: return=minimal`. `retryFailed`, `discardFailed`, `hasPending`, `getStatus`, `subscribe`.
  - `lib/sync/use-sync-status.ts`: `useSyncExternalStore` over Dexie core `liveQuery` (counts, failed rows, `last_sync_at`) merged with the queue's in-memory state. Restarts the observable if it errors or completes.
  - `components/field/sync-provider.tsx`: mount, `online`, `visibilitychange`→visible, `focus`, `pageshow` (persisted), 30 s timer while visible and pending. Development-only `window.__d2dSyncDebug` (`enqueueSynthetic`, `flush`, `dump`, `serverCount`, `reset`, `status`) behind `NODE_ENV === "development"`.
  - `components/field/sync-status.tsx`: header line (`3 to send · waiting for signal · last sent 14:02`, `Sign in again to send 3 knocks`, `Everything sent · last sent 14:02`) and a rejection banner per failed row with 44 px Retry / Discard. Border and text only; no colour carries meaning.
  - `app/(field)/layout.tsx` renders `<SyncProvider>`. `field-prop.tsx` gains `<SyncStatus />` under "Signed in as".
  - Offline identity (plan open question, confirmed in scope): `rememberCanvasser(uid)` writes `sync_meta.last_canvasser_id` on every successful online load (payload or honest-empty); `getCachedToday(uid | null)` falls back to it when `getSession()` has nothing. Native-IndexedDB fallback reader added for `sync_meta` to match the existing one for `assignments`.
  - `scripts/verify-stage-7.ts` (`npm run verify:stage7`, `--keep`, `--cleanup`).
- **Policies:** none new — no schema change.
- **Acceptance:**
  Harness: Node half with three throwaway users (admin, canvasser, second canvasser), a Bishopston street-ring territory allocated to the canvasser for today, every insert made with the canvasser's real JWT through the queue's own `sendOp`; service role only for fixtures, counts and cleanup. 45 checks, 45 pass on the final run; fixtures deleted (`leads=2 knock_events=3`, territory, users). Browser half in the Cursor browser (Windows 11 desktop Chromium) at `localhost:3000/field` signed in as the kept harness canvasser, connectivity controlled with CDP `Network.emulateNetworkConditions` / `Network.setBlockedURLs`, rows counted on the server by `client_event_id` from the same tab. Kept fixtures then deleted (`knock_events=168` across every browser run, `leads=2`).
  - 50 queued events flush without loss: **PASS** — tab offline (`navigator.onLine=false`), `enqueueSynthetic(50)` → 50 pending, 0 attempts, header `50 to send`. Emulation off → `online` event → 50 synced, `synced_at` monotonic in `seq` order, server 50/50 for those ids, `missing: []`, header `Everything sent · last sent 16:46`.
  - Killing the app mid-flush and reopening produces no duplicates and no losses: **PASS** — 50 queued offline, online with 400 ms emulated latency, `location.reload()` at 30 synced / 20 pending while `state=syncing`. Reopened tab: mount flush finished the rest, 50 synced / 0 pending / 0 failed, server 50 rows for 50 ids, `missing: []`, no row carrying a `23505`. (A first attempt without latency finished all 50 before the reload fired; repeated with latency so the kill was genuinely mid-flush.)
  - Deliberately replaying the same `client_event_id` twice results in one row: **PASS** — Node: `sendOp` twice → `ok` then `duplicate`; `knock_events=1 leads=1` for that id. Partial replay: knock-only send, then knock+lead with the same ids → knock `23505` swallowed, lead inserted, `1/1`, third send `duplicate` and still `1/1`. Browser: second `enqueue` of one id → `already_queued`, one outbox row; a synced row flipped back to pending by hand and re-flushed → `synced`, `last_error=null`, server unchanged (51/51).
  - Server rejection with a 4xx does not retry forever; it surfaces to the user: **PASS** — Node: another user's `canvasser_id` → 403 `42501` permanent; non-member JWT → `42501` permanent; ghost UPRN → 409 `23503` permanent (not duplicate); `outcome='bogus'` → 400 `23514` permanent; lead carrying `status` → `42501` at the lead step (the generated-type trap, now unreachable through `CanvasserLeadInsert`); garbage JWT → 401 `PGRST301` auth. Browser: ghost-UPRN knock → `failed`, `attempts=1`, `nextAttemptAt=null`; after two manual flushes and 36 s (past the 30 s timer) still `attempts=1`. Banner `1 knock was rejected by the server. Knock at Door 1 · 23503 · …` with Retry and Discard both 44 px. Retry → one more send, `attempts=2`, parked again. Discard → row gone, banner gone, `Everything sent`.
  - Queue survives a browser restart: **PASS with a caveat** — 5 queued offline (header `5 to send · waiting for signal`), tab closed, new tab with `*.supabase.co/rest/*` blocked, `/field` opened: same 5 ids present, 5 pending, row 1 `attempts=4` with `Failed to fetch`, rows 2–5 `attempts=0` (head-of-line held), `state=backoff`, `next attempt in 6.7 s`, header `5 to send · retrying shortly`. Unblocked → the scheduled `retry` (no `online` event) synced all 5, server 5/5. **Caveat:** this is a tab close and reopen in the Cursor-embedded Chromium, not a browser process restart. IndexedDB persistence across a process restart is a platform guarantee that was not separately exercised here.
  - Not in the checklist, verified: `sync_meta.last_canvasser_id` written on online load (`2d7b4b7c-…` = the signed-in uid); Dexie at version 30 (3) with `assignments`, `outbox`, `sync_meta`; `navigator.locks` present; classify/backoff/validateOp unit checks (14 + 5 + 6) pass; `tsc --noEmit` clean; `eslint --max-warnings 0` clean on every Stage 7 file.
  - Not verified, by instruction: the offline-identity fallback under real token expiry (manual, after both Stage 7 sessions).
- **Deviations from brief / plan:**
  - **Dexie opened with `cache: "disabled"`.** Found during the browser pass: Dexie 4.4.6's liveQuery cache middleware keeps a null optimistic op after a failed `add()` (the `ConstraintError` on a duplicate `client_event_id`) and every subsequent re-query throws `Cannot read properties of null (reading 'type')` in `applyOptimisticOps`, which kills the observable and freezes the header on a stale count. Three fixes, all kept: the cache is disabled (tables are tiny), `enqueue` checks for the id before adding so the error path is not hit in the first place (the `ConstraintError` catch remains as a race fallback), and the hook resubscribes if the observable errors or completes.
  - `enqueue` while `navigator.onLine === false` sets state `offline` immediately instead of leaving `idle`, so the header reads `waiting for signal` before the first flush attempt.
  - Rows for another canvasser (`held`) are skipped without breaking their assignment's group, per plan decision 8.
  - `app/(field)/layout.tsx` renders only `<SyncProvider>`; `<RegisterServiceWorker>` is the service-worker pass.
  - Ghost UPRN for the FK test is `999_999_999_999`, asserted absent first — UPRN `1` exists in Bristol's OS Open UPRN extract and the first run inserted a real row against it.
  - `sendOp` is exported from `queue.ts` (not a separate module) so the Node harness drives the identical wire path; the plan's file list is otherwise followed exactly.
- **Not done / deferred:**
  - Service worker, manifest, icons, `offline.html`, `middleware.ts` matcher, `next.config.ts` headers — the separate Stage 7 pass.
  - Stage 8: no knock UI, nothing calls `enqueue` outside the development harness. No `property_observation` producer yet (the type and send path exist).
  - Pruning of `synced` outbox rows (plan decision 5) — nothing deletes them yet; ~150 small rows a day. Decide alongside Stage 8's read model.
  - Offline-identity fallback under a genuinely expired token — manual, yours.
  - A real phone, real-network run of any of the above.
- **Follow-ups:**
  - On app open with pending rows and no signal, mount + focus + visibilitychange each reset the backoff and fire within a second (row 1 showed `attempts=4` after ~3.5 s). Harmless but chatty; a short cooldown on external triggers would trim it.
  - Stage 8 must pass the queue one `client_event_id` per door-visit action and `newRowId()` for `knock.id`, and build the lead with `knock_event_id = knock.id`; `validateOp` refuses anything else.
  - `window.__d2dSyncDebug` is development-only and reads `knock_events` for its own ids (`serverCount`); it is not a write path and is tree-shaken from production.
  - Dexie: re-check whether a later 4.x fixes the `applyOptimisticOps` null-op bug before re-enabling the cache.

---

### Stage 07 — Sync queue (session 2 of 2: app-shell service worker). Stage 7 complete ✅ — sync queue + service worker. Next: Stage 8.
- **Date:** 2026-09-15
- **Model:** Claude Fable 5.1 (Cursor)
- **Built:** The app shell, per `docs/plans/stage-7-plan.md` §1 (service-worker rows) and §4. No migration; `supabase/migrations`, `lib/supabase/types.ts` and every file under `lib/sync/` untouched. No new dependency.
  - `public/sw.js` — hand-rolled, plain JS, ~280 lines, scope `/`. Two caches: `d2d-shell-v{SW_VERSION}` (precache + `/field` HTML + `/maplibre/*`; deleted on activate when the version changes) and `d2d-static` (hashed `/_next/static/*`, unversioned, pruned on activate by `Date` header older than 14 days). Install precaches `/offline.html` (required), `/manifest.webmanifest`, `/icons/*`, `/maplibre/*.mjs` (best effort each). `skipWaiting` on install, `clients.claim` on activate. Fetch handler is an allowlist over same-origin GETs: `/_next/static/**` cache-first; `/maplibre/**` stale-while-revalidate; precached paths cache-first; navigations to `/field` or `/field/**` network-first with a 3 s timeout → cached document → `/offline.html`, cached only when `ok && !redirected && type === "basic"` and `content-type` is HTML, keyed by path without query, and the late network response still refreshes the cache. Everything else — `/admin`, `/office`, `/login`, `?_rsc=` payloads, POSTs, every cross-origin request (Supabase REST/Auth/Realtime, MapTiler) — returns without `respondWith`. No `sync`/`periodicsync` handler; no IndexedDB access. `message` handler: `WARM` (page-supplied `/_next/static/` URLs and, on the first uncontrolled load only, the document path, fetched with same-origin cookies) and `PING` → `PONG { version, startedAt }` for diagnostics.
  - `components/pwa/register-sw.tsx` — `"use client"`, production only, registers `/sw.js` (`scope: "/"`, `updateViaCache: "none"`) after `load`, posts every same-origin `/_next/static/` URL from `document.scripts`, `link[href]` and resource timing, then keeps posting via a `PerformanceObserver` (1.5 s debounce) as fonts and late chunks arrive.
  - `app/(field)/layout.tsx` — renders `<RegisterServiceWorker />` inside `<SyncProvider>`. Only the field group registers a worker.
  - `app/manifest.ts` → `/manifest.webmanifest`: placeholder identity (`name`/`short_name` `nakolabs-d2d`), `start_url` `/field`, `scope` `/`, `display` `standalone`, `orientation` `portrait`, `background_color` `--color-worksheet`, `theme_color` `--color-paper`, `lang` `en-GB`, icons 192/512 (+512 maskable).
  - `public/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180) — placeholder artwork generated from palette tokens (`--color-prop` square, `--color-paper` door dot) with a throwaway pure-Node PNG encoder; no image dependency added, generator not committed.
  - `public/offline.html` — static, palette tokens inline, 44 px "Try again". Served only when `/field` is requested offline and has never been cached.
  - `app/layout.tsx` — `metadata.appleWebApp` (`capable`, `statusBarStyle: "default"`, title), `icons.apple`, `viewport.themeColor`. Manifest `<link>` is automatic.
  - `middleware.ts` — matcher now also excludes `sw.js`, `manifest.webmanifest`, `offline.html`, `icons/`, `maplibre/`.
  - `next.config.ts` — `headers()`: `/sw.js` → `Cache-Control: no-cache, must-revalidate`, `Service-Worker-Allowed: /`.
- **Policies:** none new — no schema change.
- **Acceptance:**
  Harness: production build (`next build --turbopack`, `next start -p 3100`) in the Cursor browser (Windows 11 desktop Chromium), signed in as the kept Stage 7 harness canvasser with today's 69-door Bishopston allocation; connectivity via CDP `Network.emulateNetworkConditions`; server rows counted by `client_event_id` with the service role from Node. Fixtures deleted afterwards (`knock_events=143`, `leads=2`, territory, users). The dev build was not used: registration is `NODE_ENV === "production"` only.
  - App force-quit + zero network + reopen (not a warm tab) still renders the shell and last-cached prop from Dexie: **PASS** — after one online visit the shell cache held the 7 precache entries plus `/field` (12,954 B, `basic`, 200, contains the signed-in name and no door data) and `d2d-static` held all 18 `/_next/static/` assets the page loaded (17 JS chunks + 2 CSS + 3 `woff2`), zero cross-origin entries. Worker `startedAt` recorded (`…445302`). Tab closed, `next start` process killed (port 3100 refused connections), 45 s wait, new tab set offline *before* navigating, `GET /field`: navigation `200`, `transferSize 0`, `responseStart 6 ms`; every one of the 18 static assets `transferSize 0` with `workerStart > 0`; `todays_assignment` RPC failed with status 0 and `workerStart 0` (passed through, not handled); worker `startedAt` `…600291` (155 s later — a fresh boot, not the same instance); header `STAGE 7 TEST PROP — DELETE ME / Visit 1 · starting from the east · anticlockwise · mid · 69 doors`, `Nothing to send`, `Showing the copy saved on this phone.`, 69 door rows, map canvas present. Map tiles came from the browser HTTP cache, not the worker (the caches hold nothing from `api.maptiler.com`). Screenshot taken. Fallback also exercised: `/field` entry deleted from the shell cache, tab offline, `GET /field` → `/offline.html` ("Not ready for offline use." / "Open the app once with signal to prepare it for offline use.") with a 44 px Try again.
  - Service worker install/activate does not swallow or delay a Dexie flush on reconnect: **PASS**, three ways.
    - Steady state (worker active, controlling): 20 rows seeded pending in the outbox while offline, tab online → 20 `POST /rest/v1/knock_events`, all `201` (the +1.82 s to the first request in this run is tool round-trip latency between "arm" and "go online"; the clean figure is in the next line); 20 synced / 0 failed, `attempts` all `0`, `synced_at` monotonic in `seq`, span 896 ms. Every request dispatched through the worker (`workerStart > 0`), `fetchStart − workerStart` 5.7 ms for the first (worker wake) then 0.1–0.3 ms each; nothing served from cache (caches contain no Supabase entry, all responses `201`).
    - Same again with the `online` event timestamped inside the page: 10 rows, first request **4 ms** after `online`, last response +501 ms, last `synced_at` +502 ms, 10/10 on first attempt.
    - Racing install/activate: worker unregistered and both caches deleted, 40 rows seeded pending and `location.reload()` called in the same script. Relative to the reload: document at +1 ms, uncontrolled; install precache fetched at ≈+440 ms; mount flush's first POST at +576 ms (no worker); worker claimed the page at ≈+630 ms *with that request in flight*; the remaining 39 POSTs dispatched through the new worker; all 40 `201`; 40 synced / 0 pending / 0 failed, every row `attempts 0`, last `synced_at` +2,344 ms; post-activation warm-up cached `/field` at +1,440 ms. Nothing was aborted, retried, or slowed by the claim.
    - Server: 140/140 browser-queued ids present, 0 missing, 0 duplicated (canvasser total 143 = 140 + 3 from the Node harness). Header `Everything sent · last sent 17:35`.
  - Not in the checklist, verified: online navigation is network-first (cached `/field` `Date` header equals the navigation start on each online load; the shell HTML carries the signed-in name and no door data); a controlled page does not re-fetch its own document for warm-up (`0` extra `/field` requests); `/sw.js` served with `cache-control: no-cache, must-revalidate` and `service-worker-allowed: /`; `<link rel=manifest>` at `/manifest.webmanifest`, `apple-mobile-web-app-capable=yes`, `theme-color #fbfaf8`; `tsc --noEmit` clean; `eslint --max-warnings 0` clean on every file touched; `next build` clean (12/12 pages).
  - Not verified: an installed home-screen app on a real phone (iOS partitioned storage, Android install prompt); a real airplane-mode reopen on a device; the 14-day `d2d-static` prune (no entry is old enough yet); behaviour after a production deploy changes the chunk set (reasoned, not exercised on Vercel).
- **Decisions (this stage):**
  - **Network-first for `/field` HTML, not literal cache-first.** Literal cache-first would skip middleware's cookie refresh on every open, keep booting the old build after a deploy until `sw.js` itself changed, and hand a signed-out user the shell instead of `/login`. Offline behaviour is identical: network fails fast → cached copy. Cache-first is kept for hashed assets only, which is what "cache-first for the app shell" in `offline-shell.mdc` protects.
  - **`next-pwa` rejected.** Webpack-plugin based and effectively unmaintained against Next 15/Turbopack; pulls Workbox; its generated worker runtime-caches API responses by default, which is the exact behaviour the Dexie-owns-data rule forbids. **`@serwist/next` rejected.** Maintained, and it would give true install-time precache of hashed chunks via build-manifest injection, but that buys nothing here — a device that has never been online has an empty Dexie and nothing to show — at the cost of a bundler integration and Workbox-style caching defaults to disable. Hand-rolled `sw.js` is small enough that owning it is cheaper than configuring around a library. Also not added: `uuid`, `dexie-react-hooks`, `fake-indexeddb`, any PNG library.
  - **Hashed chunks are warmed after load, not precached on install.** Chunk names are content-hashed at build; a static `public/sw.js` cannot list them. The page posts what it actually loaded and the runtime cache-first handler catches anything missed.
  - **Offline-identity fallback stands as built in session 1** (`sync_meta.last_canvasser_id`, used only when `getSession()` has nothing). The cold-open above ran with a live session; the expired-token path is still the manual check below.
  - Registration is production-only and field-layout-only. Once registered on a device the worker's scope is `/`, so it will also see `/admin` and `/office` navigations on that device — and pass them through untouched.
- **Deviations from brief / plan:**
  - `PING`/`PONG` message added to the worker for diagnostics (proves a cold boot in acceptance; useful for version checks after deploys). Not in the plan.
  - Precache is per-URL best effort, not `cache.addAll`; only `/offline.html` failing fails the install. A missing icon must not leave a device without a worker.
  - On a controlled load the page does not warm its own document (the navigation handler already cached it); only the first, uncontrolled load posts `location.pathname`. Saves one HTML round-trip with a middleware `getUser()` per open.
  - `/sw.js` also carries `Service-Worker-Allowed: /` (harmless at root scope; explicit).
  - `Cache-Control: private, no-store` from middleware is on the cached `/field` document. The Cache API ignores it by design — this is the whole point — but it means the copy can outlive the session that produced it (see follow-ups).
- **Not done / deferred:**
  - Branding: app name, icon artwork, theme colour are placeholders by instruction.
  - Stage 8: no knock UI, nothing calls `enqueue` outside the development harness.
  - MapTiler tiles are not cached by the worker (data cache concern, outside "app shell"). Offline with a cold HTTP cache the map is dots on the plain worksheet background, as in Stage 6.
  - Pruning of `synced` outbox rows — still nothing deletes them (plan decision 5; decide with Stage 8's read model).
  - Offline-identity fallback under a genuinely expired token — **code done, manual verification still pending** (load prop, airplane mode, wait > 1 h, force-quit, reopen).
  - A real phone, real network, real home-screen install.
- **Follow-ups:**
  - **Hard gate before Stage 8: the Stage 6 tap-accuracy test on a real phone, on a real terraced street, at zoom 19, has still not run.** Stage 8 builds the knock logger on top of that target size; the brief says stop and redesign the target before Stage 8 if tapping the right door is unreliable. It is yours to run.
  - Shared phone: the cached `/field` HTML carries the last signed-in name until the next online load. Dexie is keyed on `last_canvasser_id`, so the *prop* shown is the right one; only the "Signed in as" line can be stale. Acceptable for now; revisit if the office ever hands one phone to several canvassers.
  - Bump `SW_VERSION` whenever the precache list or the caching rules change; hashed assets need no bump.
  - Development never registers the worker. To test shell behaviour locally use `next build && next start -p 3100`; do not run `next build` while `next dev` is up (Stage 4 follow-up still applies).
  - iOS: an installed home-screen app has its own cookies and IndexedDB, partitioned from Safari. A canvasser must sign in and load the prop once *inside the installed app*; warming Safari does not warm the icon. Installed apps are also exempt from Safari's 7-day storage eviction, which is a second reason to steer canvassers to the icon.
  - **Next step: Stage 8 — Knock logger.** The queue is the only write path (`enqueue` with one `client_event_id` per door-visit action, `newRowId()` for `knock.id`, lead built with `knock_event_id = knock.id`); the shell is in place; nothing in Stage 8 should touch `public/sw.js`.

---

### Stage 1c — Address labels (data layer)
- **Date:** 2026-09-16
- **Model:** Cursor Grok 4.6
- **Built:** `property_addresses` (UPRN PK → `properties`, display fields only, source/confidence checks, street and postcode indexes). RLS on; SELECT for `authenticated` only; no write policy. Ingest RPCs `upsert_property_addresses(jsonb)` (confidence-aware, joins `properties`) and `list_property_uprns` (keyset pages as jsonb), EXECUTE `service_role` only. `scripts/ingest-addresses.ts --pass=epc` streams `data/raw/epc-bristol/certificates.csv`, votes street per EPC postcode, parses labels, upserts in batches of 750. Track B passes log `not implemented, Track B` and exit 0. `lib/supabase/types.ts` regenerated. `npx tsc --noEmit` exit 0.
- **Policies:** `property_addresses_select_authenticated` — SELECT to `authenticated`, `using (true)`. No INSERT/UPDATE/DELETE policy. Table GRANT: SELECT to `authenticated` only (anon none). Function EXECUTE: `service_role` only after 012.
- **Acceptance:**
  - Re-running the ingest changes no row counts: **PASS** (first and second run both 82,381 written / 81,404 exact / 977 street_only)
  - A known Bristol street is spot-checked door by door against reality: **PASS** — Wells Road, Totterdown `BS4 2BU` odds 149–173 match the source certificates (`149 WELLS ROAD | TOTTERDOWN`, `151, Wells Road`, `Flat 1 | 157 Wells Road`, `163, Wells Road`) and form a continuous terrace. Not a pavement walk.
  - A lower-confidence pass cannot overwrite an `exact` row: **PASS** — `upsert_property_addresses` of UPRN 97 as `osm`/`street_only` returned 0; row stayed `exact` / `9` / `Charlton Gardens` / `epc`
  - Unmatched UPRNs are absent from the table, not present with nulls: **PASS** — `house_number is null and street_name is null` = 0; `inferred` = 0
  - Coverage reported as a percentage of Bristol UPRNs in `properties`: **PASS** — 19.39% (82,381 / 424,952)
  - No address column exists on `properties`, `knock_events`, `leads` or in `uprn_snapshot`: **PASS** — `house_number`/`street_name`/`building_name`/`sub_building` exist only on `property_addresses`; `assignments.uprn_snapshot` remains `_int8[]`
- **RLS (simulated JWT, not a real login cookie):** as `authenticated`, SELECT count = 82,381; INSERT/UPDATE/DELETE = `42501`; `upsert_property_addresses` EXECUTE = `42501`. as `anon`, SELECT = `42501`.
- **Deviations from brief:**
  - Second migration `012_property_addresses_revoke_execute.sql`. Reason: Supabase default privileges grant EXECUTE to `anon` and `authenticated` on new functions; 011's `revoke from public` left those role grants in place. Alternative rejected: editing applied 011.
  - Ingest RPCs `list_property_uprns` and `upsert_property_addresses` are not in the brief's CREATE TABLE block. Same pattern as Stage 1's `upsert_properties`. Alternative rejected: 425 PostgREST pages of 1,000 UPRNs, and client-side confidence filtering.
  - Street vote uses a strict majority (>50% of field-votes). Unique plurality below 50% is treated as a failed vote. 3,615 postcodes failed; 56,650 matched UPRNs were not inserted. City-centre blocks (Creswicke House / St. Giles Court / Small Street) typically tie building name with street and are absent, as specified (“do not force a winner”).
  - Date column detected at runtime; this extract used `lodgement_datetime`.
- **Not done / deferred:** `--pass=osm|linked_ids|land_registry`. Interpolation pass (`inferred`). Field display / Dexie `addresses` store (Stage 6 amendment). Stage 8. Nothing under `app/(field)` or Dexie. Did not backfill `properties.postcode` (still NULL on every row). Did not go through `lib/sync/queue.ts`.
- **Follow-ups:** Coverage is 19.39% of OS Open UPRN points, not the 50–60% the brief guessed for dwelling-like UPRNs. Unique EPC UPRNs in `properties` were 139,031 (32.7%); the rest of the drop is failed street votes. A later pass can fill unmatched UPRNs; it must not overwrite `exact`.
- **Numbers:**
  - rows read / usable uprn / matched to `properties`: 183925 / 178363 / 178357
  - distinct UPRNs written: 82381
  - coverage: 19.39%
  - exact / street_only: 81404 / 977
  - postcodes where street vote failed: 3615
  - 20 most common `street_name`: Wells Road 358, Long Cross 301, Whitehall Road 289, Ashley Down Road 275, Stapleton Road 255, St. Johns Lane 250, Bishport Avenue 245, Two Mile Hill Road 188, Wordsworth Road 171, Ridgeway Road 168, Portway 159, Paxton Drive 155, Bishopsworth Road 153, Clouds Hill Road 153, Greystoke Avenue 152, Cranbrook Road 151, Ilchester Crescent 151, Bloomfield Road 149, Speedwell Road 149, Stackpool Road 149

---

### Stage 1c — Address labels (parser fix: drop the postcode street vote)
- **Date:** 2026-09-16
- **Model:** Cursor Grok 4.6
- **Built:** Replaced the EPC postcode-majority street vote with a per-row parse in `scripts/lib/epc-address.ts` / `scripts/ingest-addresses.ts`. Street = last of address3/address2/address1 containing a street-type suffix (optional North/South/East/West). House number = leading number of that field, else the preceding field when it is only a number. Both fields starting with a digit → `house_number` null / `street_only`. Never borrows Flat/Studio/Unit numbers. Certificate pick prefers `uprn_source='Address Matched'`, then most recent `lodgement_datetime` parsed from the stored value. Postcode modal is a flag only (`spatial_approx`); `street_name` is not rewritten. Title-case on `street_name` and letter suffixes on `house_number`. Migration `013_property_addresses_epc_attrs.sql` adds `property_type` and `uprn_source`; recreates `upsert_property_addresses` to write them and to let a same-source re-run replace its own rows. The epc pass deletes previous `source='epc'` rows then INSERTs, so previously-rejected postcodes are not stuck on an UPDATE of a missing row. `lib/supabase/types.ts` regenerated. `npx tsc --noEmit` exit 0.
- **Policies:** none new. Existing `property_addresses_select_authenticated` (SELECT, `authenticated`, `using (true)`) covers the two new columns. No write policy. EXECUTE on `upsert_property_addresses` remains `service_role` only after 013's revoke/grant.
- **Acceptance:**
  - Re-running the ingest changes no row counts: **PASS** — first and second run both 132,977 written / 106,314 exact / 592 spatial_approx / 26,071 street_only / 0 inferred
  - A known Bristol street is spot-checked door by door against reality: **PASS** — Wells Road, Totterdown `BS4 2BU` odds 141A–173, title-cased (`141A` not `141a`), Flats 1–4 at 157/159/161. Not a pavement walk. **Also** `BS1 1DB` (Creswicke House, 9 Small Street, studios A1–D6) and `BS1 1DZ` (St. Giles Court flats are `street_only` on Small Street; Flat 17 / `14 St. Giles Court` were not written as house numbers)
  - A lower-confidence pass cannot overwrite an `exact` row: **PASS** — `upsert_property_addresses` of UPRN 123665 as `osm`/`street_only` returned 0; row stayed `exact` / `163` / `Wells Road` / `epc`
  - Unmatched UPRNs are absent from the table, not present with nulls: **PASS** — `house_number is null and street_name is null` = 0; `inferred` = 0
  - Coverage reported as a percentage of Bristol UPRNs in `properties`: **PASS** — 31.29% any label (132,977 / 424,952), 25.02% exact (106,314 / 424,952)
  - No address column exists on `properties`, `knock_events`, `leads` or in `uprn_snapshot`: **PASS** — `house_number`/`street_name`/`building_name`/`sub_building` exist only on `property_addresses`; `assignments.uprn_snapshot` remains `bigint[]`
- **RLS (simulated JWT, not a real login cookie):** as `authenticated`, SELECT count = 132,977; INSERT/UPDATE/DELETE = `42501 permission denied for table property_addresses`; `upsert_property_addresses` EXECUTE = `42501 permission denied for function`. as `anon`, SELECT = `42501`.
- **INSERT path:** first run deleted 139,031 previous epc rows then upserted 132,977 (row_count = write set, all INSERTs). Surgical check: DELETE UPRN 123665 then `upsert_property_addresses` of that one row returned 1 and restored `163 Wells Road`.
- **Deviations from brief / expected numbers:**
  - All-certificate rows with a house number and street *before* the ambiguous-null rule: 142,561 + 730 = 143,291 (77.91%) vs expected ~143,337 (77.93%). After nulling the 730 double-number rows: 142,561 (77.51%). Not material.
  - Distinct UPRNs with a house number: 106,906 (76.89% of 139,031) vs expected ~107,962 (77.65% of 139,035). −1,056 / −0.76pp. Coverage still landed in the quoted band.
  - Postcodes with exactly one parsed street: 91.51% vs 91.16%. 592 `spatial_approx` rows are minorities on multi-street postcodes (a unique-street postcode cannot disagree). `street_name` was not rewritten.
  - Ambiguous double-number rows: 730 vs 713.
  - Same-source re-run of epc now overwrites even when confidence falls, so a parser fix can demote `exact` → `spatial_approx`. A *different* source still cannot overwrite a higher-confidence earlier pass.
- **Not done / deferred:** `--pass=osm|linked_ids|land_registry` (`osm` still logs `not implemented, Track B`). Interpolation (`inferred`). Field display / Dexie `addresses` store. Stage 8. Nothing under `app/(field)` or Dexie. Did not backfill `properties.postcode`. Did not edit 011 or 012.
- **Follow-ups:** `Park` / `Vale` as suffixes put neighbourhood names such as Westbury Park and Arnos Vale into the top-20 streets when they sit in a later address field than the true street. Spec-compliant (last suffix field wins). A later pass can fill unmatched UPRNs; it must not overwrite `exact`.
- **Numbers:**
  - rows read / usable uprn / matched to `properties`: 183925 / 178363 / 178357
  - rows yielding house number + street (all certificates, after rule 4): 142561 (77.51%)
  - distinct UPRNs written / with a house number: 132977 / 106906
  - coverage: 31.29% any label, 25.02% exact (was 19.39% / 81,404 exact)
  - exact / spatial_approx / street_only: 106314 / 592 / 26071
  - Address Matched preferred over a newer Energy Assessor row: 458
  - uprn_source on written rows: Energy Assessor 119834, Address Matched 13143
  - 20 most common `street_name`: Fishponds Road 796, Whitchurch Lane 705, Redcliff Street 661, Stapleton Road 590, Church Road 580, Gloucester Road 566, St. Annes Park 529, Westbury Park 504, Queens Road 472, Wells Road 435, Hotwell Road 422, Arnos Vale 418, New Kingsley Road 416, West Street 405, Bishport Avenue 403, Pembroke Road 378, St. Thomas Street 369, North Street 365, Lake Shore Drive 363, Redland Road 362

---

### Stage 1c — Address labels (suffix tiers: weak locality yields to earlier strong street)
- **Date:** 2026-09-16
- **Model:** Cursor Grok 4.6
- **Built:** Split street suffixes into STRONG and WEAK. If the last suffix-bearing field is WEAK-only and an earlier field is STRONG, use that earlier field. Parser lives in `scripts/lib/epc-address.ts` (called only from `scripts/ingest-addresses.ts`). No named-locality list. No migration.
- **Acceptance:** Re-run `--pass=epc` twice: **PASS** — both 132,391 written / 107,613 exact / 443 spatial_approx / 24,335 street_only. Table vs previous write: 0 street_name changes on the second run.
- **Deviations:** The rule is in `epc-address.ts`, not inlined in `ingest-addresses.ts` — that file only orchestrates ingest and the change log. Remaining Westbury Park 159 and St. Annes Park 132 are rows with no earlier STRONG field (same shape as Cotham Park). Suffixes that were on the old single list but not in either new tier (Mews, Causeway, Promenade, …) no longer count as streets.
- **Not done / deferred:** No migration, no field UI, no Stage 8, no Track B passes.
- **Numbers vs previous ingest (132,977 / 106,314 exact / 592 spatial_approx / 26,071 street_only):**
  - written 132,391 (−586)
  - exact 107,613 (+1,299)
  - spatial_approx 443 (−149)
  - street_only 24,335 (−1,736)
  - coverage 31.15% any label, 25.32% exact
  - vs previous parser: 2,014 renamed, 768 gained a street, 1,354 lost a street (4,136 UPRNs differed)
  - top 20: Fishponds Road 796, Whitchurch Lane 705, Redcliff Street 661, Church Road 617, Stapleton Road 590, Gloucester Road 566, Queens Road 472, Wells Road 435, Hotwell Road 422, New Kingsley Road 416, West Street 405, Bishport Avenue 403, Pembroke Road 378, St. Thomas Street 369, North Street 365, Lake Shore Drive 363, Redland Road 362, Ashley Down Road 360, Somerset Street 359, East Tucker Street 350. Westbury Park and St. Annes Park are no longer in the top 20.

---

### Stage 1c — Address labels (promotion house-number gate + restored strong suffixes)
- **Date:** 2026-09-16
- **Model:** Cursor Grok 4.6
- **Built:** Promotion of an earlier STRONG field over a later WEAK field now requires a house number on that strong field, or a house-number-only field immediately before it. Added to STRONG (none removed): Mews, Causeway, Promenade, Passage, Path, Steps, Hillside, Meadows, Fields, Croft, Orchard, Approach, Broadway, Circus, Embankment. Parade was already in STRONG.
- **Acceptance:** `--pass=epc` twice: **PASS** — both 133,619 / 108,546 exact / 452 spatial_approx / 24,621 street_only. Second run vs table: 0 renamed.
- **Deviations:** 447 UPRNs still lose a street vs the 132,977 last-suffix parser. Those fields ended in Yard, End or Crest — on that run's suffix list, never added to either current tier, not on this session's add list. Nothing was removed from STRONG or WEAK.
- **Not done / deferred:** No migration, no field UI, no Stage 8.
- **Numbers:**
  - vs 132,391 / 107,613 / 443 / 24,335: written 133,619 (+1,228), exact 108,546 (+933), spatial_approx 452 (+9), street_only 24,621 (+286)
  - vs 132,977 / 106,314 / 592 / 26,071: written 133,619 (+642), exact 108,546 (+2,232), spatial_approx 452 (−140), street_only 24,621 (−1,450)
  - promotion rule fired: 1,509 (down from 2,014 unguarded renames)
  - vs 132,977 parser: 1,527 renamed, 1,089 gained a street, 447 lost a street
  - vs 132,391 table (first write of this fix): 668 renamed, 0 rows dropped from that set

---

### Stage 8 — Knock logger (redesign, documentation only)
- **Date:** 2026-09-17
- **Model:** Cursor Grok 4.6
- **Built:** Documentation and configuration for the Stage 8 redesign. Applied `BRIEF-AMENDMENTS-STAGE-8.md` blocks A–N to `docs/D2D-Build-Brief.md`. Synced `AGENTS.md`, `.cursor/rules/00-core.mdc`, and `.cursor/skills/field-write/SKILL.md`. Created `docs/STAGE-8-SEAMS.md` and `.cursor/skills/outcome-mapping/SKILL.md`. No application code, no SQL, no migrations.
- **Acceptance:** documentation session — not Stage 8a/8b implementation.
  - Brief amendments A–N applied exactly as written: **PASS** (A, B, C, D, E, F, H, I, K appended as dated notes; G replaced Stage 8 body; J, L, M, N in-place)
  - Invariant 2 amended: eligibility facts (NCCZ, `do_not_call`, `no_opportunity`) may persist in `/field`; quality signals may not; current-assignment outcome colour permitted, previous-visit outcome colour banned: **PASS** (brief note + `AGENTS.md` + `00-core.mdc`)
  - Invariant 5 amended (second narrowing): house number may be typed against an already-selected UPRN into `address_observations`; search/autocomplete/street-postcode/address-as-identifier remain banned: **PASS** (brief note + `AGENTS.md` + `00-core.mdc`)
  - Stage 7 full-spec verification recorded: **PASS** as a dated note under Stage 7 (queue shipped to the full Section 6 specification, not Track A "-lite"; Track B "harden 7 to full" closed). This session did **not** re-run Stage 7 acceptance tests.
- **Deviations from brief:** none in application code — none was written. `AGENTS.md` Structure line for `app/(field)` now names the four tabs. `00-core.mdc` and the field-write skill were updated to match the two invariant amendments so they do not contradict the brief.
- **Not done / deferred:** Stage 8a schema. Stage 8b UI. No files under `app/`, `components/`, `lib/`, or `supabase/migrations/`. Did not write or run SQL. Did not create migrations. Did not begin Stage 8a.
- **Follow-ups:** Stage 8a is next (Frontier, highest reasoning). Pre-flight: `knock_events` and `property_observations` must both still be empty before CHECK changes.

---

### Stage 8a — Knock logger (schema)
- **Date:** 2026-09-17
- **Model:** Claude Fable 5.1 (Cursor)
- **Pre-flight:** `select count(*) from knock_events` → **0**; `select count(*) from property_observations` → **0**. Constraint names read from `pg_constraint` (`contype='c'`): `knock_events_outcome_check`, `property_observations_tenure_check`. Both happen to match the names the brief chose for the replacements, so drop-and-recreate keeps the names. Next free migration number read from `supabase/migrations/` and the remote migration list: **014**.
- **Built:** `supabase/migrations/014_stage_8a_knock_logger_schema.sql`, applied to the linked project. SQL and generated types only — no UI, no components, no Dexie, nothing under `lib/sync/`.
  - `knock_events.outcome` CHECK now has nine values including `no_opportunity`; `property_observations.tenure` CHECK gains `no_opportunity`.
  - `knock_events.notes text` with `knock_events_notes_len` (`null or length ≤ 280`).
  - Policy `"canvasser reads team knocks"` (SELECT, `authenticated`) on `knock_events`: `exists (select 1 from assignment_members am where am.assignment_id = knock_events.assignment_id and am.canvasser_id = (select auth.uid()))`. Combines by OR with `knock_events_select_own` and `knock_events_select_admin`. Insert policy untouched.
  - Indexes: `knock_events_latest_idx (assignment_id, uprn, occurred_at desc)`; `assignment_members_canvasser_idx` via `create index if not exists` — it already existed from `003_core.sql` line 73.
  - `address_observations` (`id`, `client_event_id unique`, `uprn → properties`, `canvasser_id → profiles`, `house_number` 1–12 chars, `observed_at`), index `address_observations_uprn_idx (uprn, observed_at desc)`, plus the implicit unique index on `client_event_id`. RLS enabled. Grants: `revoke all from anon, authenticated` then `grant select, insert to authenticated` (no update, no delete — corrections are new rows).
  - `leads_set_is_immediate()` — plpgsql, `security definer`, `set search_path = public, pg_temp`, EXECUTE revoked from `public, anon, authenticated`. Trigger `leads_is_immediate_biu` `before insert or update of booked_for`. Compares `booked_for` and the knock's `occurred_at` as `Europe/London` dates; `null booked_for` → `false`.
  - `v_latest_knock` and `v_door_label`, both `with (security_invoker = true)` (confirmed in `pg_class.reloptions`). SELECT revoked from `anon`, granted to `authenticated`. `v_door_label` exposes `uprn, house_number, building_name, street_name, canvasser_supplied`; no `sub_building`.
  - `addresses_for_assignment(uuid)` — `language sql stable security invoker`, `set search_path = public, pg_temp`; `revoke all … from public, anon, authenticated, service_role` then `grant execute … to authenticated`.
  - `lib/supabase/types.ts` regenerated (new table, `notes`, both views, the RPC). `npx tsc --noEmit` exit 0.
- **Policies written (role → effect):** `knock_events` `"canvasser reads team knocks"` — SELECT for any `authenticated` user who has an `assignment_members` row on that knock's assignment. `address_observations` `"authenticated read labels"` — SELECT `using (true)` for `authenticated`; `"canvasser writes own observations"` — INSERT `with check (canvasser_id = (select auth.uid()))` for `authenticated`. No UPDATE or DELETE policy or grant on `address_observations` for any JWT role. Office still has no read on `knock_events` (unchanged from Stage 2).
- **Acceptance:** harness was a temporary Node script (deleted after the run, not committed) that created five confirmed users via the Auth admin API — admin, office, canvassers c1 and c2 (a duo allocated to one Bishopston test prop, 69 doors), canvasser c3 (member of nothing) — signed each in over HTTPS and made every RLS call with that user's real `access_token` through `supabase-js`. The service role was used only for fixtures, verification counts and cleanup. Fixtures deleted afterwards; table totals after cleanup: `knock_events=0 property_observations=0 address_observations=0 leads=0`.
  - Both pre-flight counts were 0 and are recorded here: **PASS** (0 / 0, above)
  - Constraint names were read from `pg_constraint`, not assumed: **PASS** (query and both names above)
  - `'no_opportunity'` inserts succeed on both tables; an invalid value fails: **PASS** — as canvasser c1: `knock_events.outcome='no_opportunity'` inserted; `'bogus'` → `23514 … "knock_events_outcome_check"`; `property_observations.tenure='no_opportunity'` inserted; `'bogus'` → `23514 … "property_observations_tenure_check"`. Also `notes` of 281 chars → `23514 … "knock_events_notes_len"`, 280 chars accepted.
  - A canvasser JWT reads a teammate's knock on a shared assignment: **PASS** — as canvasser c2, `select id from knock_events where id = <c1's knock>` → 1 row.
  - A canvasser JWT cannot read a knock on an assignment they are not a member of: **PASS** — as canvasser c3, same query → 0 rows; `select count(*) from knock_events` → 0. As office → 0 (unchanged). As c2, INSERT with `canvasser_id = c1` → `42501` (insert policy unchanged).
  - A canvasser JWT still cannot update `leads.status`: **PASS** — as canvasser c1, `update leads set status='sale' where id = <own lead>` → `rows_updated=0`, status still `pending` (service-role read). Same result as Stage 2: no canvasser UPDATE policy, so RLS matches no rows; `leads_guard_status` is the backstop. INSERT carrying `status='sale'` → `42501 permission denied for table leads` (column grant, unchanged).
  - `address_observations`: canvasser inserts own, cannot insert as another `canvasser_id`, can read all: **PASS** — as c1, insert own (`14A`) → ok; insert with `canvasser_id = c2` → `42501 new row violates row-level security policy`; as c3 (outsider) `select` → 1 row (all rows visible). Also as c1: UPDATE → `42501 permission denied`, DELETE → `42501 permission denied`; 13-char `house_number` → `23514 … "address_observations_number_len"`; as anon SELECT → `42501`.
  - A lead booked for the knock's own day gets `is_immediate = true`; next week `false`; client-sent `is_immediate` overridden: **PASS** — as canvasser c1 with knock `occurred_at = 2026-09-17T10:00+01:00`: `booked_for` same day 18:00 with client `is_immediate=false` → stored **true**; `booked_for` 2026-09-24 with client `is_immediate=true` → stored **false**; `booked_for=null` with client `is_immediate=true` → stored **false**. UPDATE path: as office, `update leads set booked_for = 2026-09-24…` on the same-day lead → `is_immediate` flipped to **false**.
  - A 23:30 booking on the knock's own day is still `is_immediate = true` (Europe/London, not UTC): **PASS** — knock `occurred_at = 2026-09-17T00:30+01:00` (= `2026-09-16T23:30Z`), `booked_for = 2026-09-17T23:30+01:00` (stored `2026-09-17T22:30:00+00:00`). UTC dates differ (16th vs 17th); London dates match → **true**. A UTC comparison would have returned false.
  - Both views report `security_invoker` on; a canvasser reading `v_latest_knock` sees only permitted rows: **PASS** — `pg_class.reloptions` = `security_invoker=true` for both. As canvasser c2 (teammate) `select from v_latest_knock` → 8 rows; as canvasser c3 (outsider) → 0 rows; as office → 0 rows; as admin → 8 rows; as anon → `42501 permission denied for view v_latest_knock` and `… v_door_label`. As c3, `v_door_label` for the door c1 labelled → `house_number='14A', canvasser_supplied=true, street_name='Monmouth Road'` (observation beats the EPC label).
  - `v_latest_knock` returns exactly one row per (assignment, uprn) after three knocks on the same door, and it is the newest: **PASS** — as c1, three knocks on one door inserted out of order (11:05 `no_answer`, 11:10 `callback`, 11:00 `answered`); view → 1 row, `outcome='callback'`, `occurred_at=10:10Z` (= 11:10 BST). Underlying table still holds 3 rows.
  - `addresses_for_assignment` tested under a real canvasser JWT; returns no `sub_building`: **PASS** — as canvasser c1, `rpc('addresses_for_assignment', {p_assignment_id})` → 69 rows = snapshot length, 55 ms round-trip; keys exactly `building_name, house_number, street_name, uprn`; 36/69 labelled; the labelled door came back as `14A`. As canvasser c3 (not a member) → 0 rows, no error; as office → 0 rows; as anon → `42501 permission denied for function addresses_for_assignment`.
  - `lib/supabase/types.ts` regenerated and compiles: **PASS** — `npx tsc --noEmit` exit 0; diff is `address_observations`, `knock_events.notes`, `v_door_label`, `v_latest_knock`, `addresses_for_assignment`.
  - Every table still reports `rowsecurity = true`: **PASS** — `pg_class.relrowsecurity` true for `address_observations, assignment_members, assignments, knock_events, leads, nccz_zones, profiles, properties, property_addresses, property_observations, territories`. `spatial_ref_sys` false, PostGIS-owned, reported separately as in Stage 2.
  - Not in the checklist, checked: `explain analyze` of the `v_door_label` join shape for a 2,000-UPRN snapshot (as `postgres`, performance only) — index scans throughout (`properties_pkey` with `= ANY`, `property_addresses_pkey`, `address_observations_uprn_idx`), no seq scan, 748 ms cold.
- **Deviations from brief:**
  - `assignment_members_canvasser_idx` written as `create index if not exists` because `003_core.sql` already created it; the brief's bare `create index` would have failed the migration.
  - `auth.uid()` wrapped as `(select auth.uid())` in both new policies, matching every policy in 003 (initplan, evaluated once). Semantically identical.
  - Grant hygiene beyond the brief's SQL, following 003/010/012: `revoke all from anon, authenticated` then `grant select, insert` on `address_observations`; SELECT revoked from `anon` on both views; the RPC's `revoke` names `public, anon, authenticated, service_role` explicitly, because Supabase default privileges grant EXECUTE to `anon` and `authenticated` directly and `revoke from public` alone leaves those in place (the 012 lesson); `leads_set_is_immediate()` EXECUTE revoked from `public, anon, authenticated`.
  - Policy `"canvasser writes own observations"` is exactly the brief's `with check (canvasser_id = auth.uid())` — it does not gate on `app_role() = 'canvasser'` the way `property_observations_insert_canvasser` does. An admin or office user could record an observation as themselves. Kept as specified; flagged.
- **Not done / deferred:** Stage 8b (tabs, logger, sheet, Dexie stores, queue ops for `notes`, `address_observations`, `no_opportunity`). No `log_knock_outcome` RPC (rejected in the brief). No address column on `properties`, `knock_events`, `leads` or `uprn_snapshot`. `properties.postcode` not backfilled. `match_confidence='inferred'` not written anywhere. No files under `app/`, `components/`, `lib/sync/`, `lib/field/`. `lib/sync/ops.ts` wire types do not yet know about `notes` or `address_observations` — that is 8b's queue work.
- **Follow-ups:**
  - Stage 8b must send `notes` on the knock and add an `address_observation` op through `lib/sync/queue.ts`; `is_immediate` must not be sent by the client (the trigger overrides it, but `CanvasserLeadInsert` should stop carrying it).
  - `v_latest_knock` is the one latest-wins rule; Stage 9 reuses it. Do not write a second `distinct on`.
  - Office still cannot read `knock_events` or `v_latest_knock`; Stage 13 (immediates board) will need to decide whether office reads through `leads` only or gets a policy.
  - The 2,000-door `addresses_for_assignment` cold run was 748 ms as `postgres`; measure under a real canvasser JWT on a real 2,000-door prop in 8b before deciding whether the label fetch needs caching in Dexie earlier than planned.

---

### Stage 8b — Knock logger (field UI)
- **Date:** 2026-09-17
- **Model:** Cursor Grok 4.6
- **Built:** Four-tab field shell under `app/(field)/layout.tsx` (Map, Logger, Leads, Profile) sharing `SyncProvider`, `FieldDataProvider`, undo toast and tab bar. Logger sequence cursor with ✎ house-number sheet, 120px mini map, frequency-ordered outcome buttons (No Answer 96 / Contact 80 / Rented/Council 72 / Lead 72 / Other 56). Canonical mapping in `lib/field/outcomes.ts`; all writes through `lib/field/log-outcome.ts` → `lib/sync/queue.ts`. `KnockEventOp` gained `notes` plus optional nested `lead` / `observation`; `AddressObservationOp` is a separate kind, both registered in `validateOp`. `is_immediate` excluded from `CanvasserLeadInsert` and rejected if present. Dexie bumped **3 → 4** adding only `addresses` keyed on `uprn`. Outbox gained `held_undo` + `eligible_at`, 60s promotion, `promoteDue` on mount. Seams in `docs/STAGE-8-SEAMS.md` all present. MHCLG/EPC attribution on the field maps and the admin prop drawer.
- **Acceptance:**
  - Logging a knock offline, then reconnecting, produces exactly one row: **PASS** — airplane-mode Lead (cid `1e18528a-…`) sat `held_undo` then `pending` with 0 attempts; on reconnect the outbox flipped to `synced`; Postgres had exactly one `knock_events` row and one `leads` row for that cid, sharing it, `is_immediate=true` (Today PM), `is_immediate` absent from the client payload.
  - A logged door visibly changes state immediately, before sync: **PASS** — after No Answer the sequence strip showed `○ No answer` and the already-logged line appeared while the row was still `held_undo`; Postgres query for those cids returned `[]`.
  - `lead` produces one knock and one lead sharing ONE `client_event_id`, generated at the Lead tap; replay after partial failure is clean: **PASS** — Dexie payload `knock.client_event_id === lead.client_event_id === op.client_event_id`, lead keys exactly `id, client_event_id, knock_event_id, uprn, canvasser_id, booked_for, notes`; `scripts/verify-stage-8b.ts` ALL CHECKS PASSED including 3 / 3b (partial-failure recovery, `ok at lead` after knock 23505). Browser undo of cid `4b513653-…` left `leads` count 0 for that id.
  - Rented/Council → `no_opportunity` knock + `property_observations.tenure='no_opportunity'`, one cid: **PASS** — Dexie payload `outcome=no_opportunity` with `observation.tenure=no_opportunity`; harness section 4; Postgres row `a6661857-…` has both.
  - Every write goes through `lib/sync/queue.ts`. Grep `supabase.from(` / `supabase.rpc(` under `components/` and `app/(field)/`: **PASS** — zero hits. The only field RPC is `addresses_for_assignment` in `lib/field/labels.ts` (read, once on prop open). No `.update` / `.delete` on `leads` or `knock_events` from field code.
  - Undo within 60 s leaves zero rows in Postgres: **PASS** — queried four held cids immediately after log → `[]`; undid the Lead; `select count(*) from leads where client_event_id = '4b513653-…'` → 0. That cid never appeared in `knock_events` either.
  - Force-quit inside the undo window, reopen, promote and sync: **PASS** — `promoteDue()` runs on `SyncProvider` mount before the first flush; earlier in this session, rows whose `eligible_at` had passed while offline were `pending` with attempts=0, then `synced` on reconnect. Not a physical process-kill on a phone.
  - Logging the same door twice leaves two `knock_events` rows and exactly one `v_latest_knock` row, newer outcome: **PASS** — UPRN 48904 had 3 knocks (`no_opportunity` then `answered` as a correction with a new cid); `v_latest_knock` for 48904 → 1 row, `answered`. Harness section 5 also passed.
  - A 400 ms double tap logs one door, not two: **PASS** — two immediate clicks on No Answer added exactly 1 outbox row (`newAfterDouble: 1`); `useInputLock` is 400 ms.
  - Typing a house number writes one `address_observations` row and the label updates: **PASS** — earlier browser pass wrote 38A against the already-selected UPRN via `AddressObservationOp`; Dexie plate updated before sync; `v_door_label` newest-wins (38 then 38A). Harness section 6. Still visible this session as `38A Monmouth Road`.
  - A door with no label renders cleanly with the ✎ affordance — never "Unknown": **PASS** — door 5 plate `—`, sequence `3 — —` / `5 — —`; ✎ present; Notes privacy line "Do not record names or contact details."
  - `grep -r "navigator.geolocation"`: **PASS** (call sites) — zero uses. Remaining hits are prohibition comments in `lib/field/position.ts` and `components/field/mini-map.tsx`, plus the brief / AGENTS / rules. No `navigator.geolocation` in executable code.
  - Every row of `docs/STAGE-8-SEAMS.md` is ticked: **PASS** — see seams checklist below.
  - Numbers out of sequence is EXPECTED and the banner explains it: **PASS** — banner "Door order follows the interim sweep, not the street."; sequence 17, 15, —, 11, —, 38A, 5. Snapshot ordering untouched.
  - Tested on a real phone, one-handed, at arm's length: **NOT VERIFIED** — desktop Chromium only. Haptics, wet thumb, sunlight and one-handed reach were not run on a device. Field-ergonomics protocol items 1–4 of that list remain open.
- **Seams (row by row):**
  - `getSequence()` → `uprn_snapshot` order: ticked
  - `SEQUENCE_IS_ROUTE_DERIVED` = false: ticked (banner gated on it)
  - map layer `route-line`: registered, empty source: ticked (present in MapLibre style layer list)
  - `getCurrentStreetLabel()` from `v_door_label`: ticked (`Monmouth Road` under the plate)
  - header instruction slot: ticked (`HeaderInstruction` returns null)
  - out-of-order banner: ticked (visible)
  - `getRoutePosition()` returns null: ticked
  - logger auto-advance disabled: ticked (`autoAdvanceEnabled()` false; no auto-advance UI)
  - `positionEnabled` = false: ticked
  - map layer `you-are-here`: registered, `visibility: none`: ticked
  - current-door cursor in `lib/field/cursor.ts`, manual: ticked (advances one door per log; Skip does not log; no jump to next unlogged)
  - teammate line slot: ticked (`TeammateLine` returns null)
- **Deviations from brief:**
  - MapLibre rejects `["zoom"]` nested inside `*` or `case`. The first paint of `field-doors` threw `zoom expression may only be used as input to a top-level "step" or "interpolate"` and **no dots rendered**. `circle-radius` and the pale-core radius are now top-level zoom interpolates with the outcome `match`/`case` inside each stop. Same visual: lead largest, no_opportunity smallest, answered/lead get a pale core.
  - Outcome `feature-state` is applied on style `load` as well as in the React effect. The effect returned early when the style was not ready, so a remount of the Map tab left every door looking unlogged even though Dexie had outcomes. Colour is still current-assignment only, still not baked into the source.
  - Admin MHCLG/EPC line is a footer under the drawing map (`components/admin/prop-drawer.tsx`), not MapLibre `customAttribution`. The field maps use `customAttribution`. Both carry the Crown/MHCLG/EPC sentence.
  - `not_interested` remains in the CHECK and in `KNOCK_OUTCOMES` but has no button; Other records `refused` for that conversation, as the outcome-mapping skill allows.
- **Not done / deferred:** Stage 9 completion counts, Stage 10 claims / teammate line, Stage 5b route order, Stage 16 geolocation / route position, Track B ingest. No applied migration edited. Snapshot ordering not touched. No 2,000-door map test on a mid-range phone (this session: **69 doors**, desktop browser). Field-ergonomics on-device pass not done. Did not begin Stage 9.
- **Follow-ups:** Run the Logger on a real phone in sun with a wet thumb before calling the UI field-ready. Re-test `field-doors` at 2,000 points on a mid-range phone (Stage 14 will own the performance gate). `scripts/verify-stage-8b.ts --keep` leaves a named test prop; `--cleanup` removes it.

---

### Stage 8b — Knock logger (on-device fix pass)
- **Date:** 2026-09-18
- **Model:** Cursor Grok 4.6
- **Built:** Five field-test fixes. Logger mini map (`components/field/mini-map.tsx`) deleted; replaced with **Show on map**, which switches to the Map tab, centres/zooms the current door at zoom 19, and highlights it with a dark halo plus ink stroke. Cursor lives in `FieldDataProvider` and is not moved by the round trip. Map attribution is `AttributionControl({ compact: true })`; the four licence lines are permanent on Profile. Leads tab shows a read-only **Immediate** badge derived from `booked_for` vs `occurred_at` in Europe/London (trigger rule, never sent). Back/Notes/Skip moved into the Logger header so they are no longer clipped as three empty boxes above Other. `no_opportunity` display string is **Rented/Council** everywhere. Brief dated note + outcome-mapping answered/contacted rule. No migration.
- **Acceptance:**
  - FIX 1 Show on map / one MapLibre instance: **PASS** — `MiniMap` deleted. Logger has **Show on map**. Tapping it opened the Map tab on door 1 (17 Monmouth Road) and later on unlabelled door 3, both zoomed in with a dark halo distinct from neighbouring dots. Returning to Logger left the cursor on door 3. One `.maplibregl-map` on the Map tab; zero on Logger. Desktop Chromium, 69 doors.
  - FIX 2 compact attribution + Profile licences: **PASS** — field map `compact: true`; after load the control is a 24px ⓘ (`details.open === false`). Expanding still contains OS/Crown, OGL, MHCLG EPC, MapTiler and OSM. Profile lists the four required lines permanently. Admin prop drawer footer untouched (`compact: false`).
  - FIX 3 Immediate badge: **PASS** — Today-PM lead showed a green **Immediate** badge next to `Appointment Fri 18 Sept, 18:00`. Outbox lead keys were `id, client_event_id, knock_event_id, uprn, canvasser_id, booked_for, notes` — no `is_immediate`.
  - FIX 4 ghost boxes above Other: **PASS** — mini map markup gone. Phone-width (390px) Logger screenshot: Back/Notes/Skip labelled at the top; sequence row then Other; no three empty clipped boxes.
  - FIX 5 Rented/Council wording: **PASS** — button, sequence (`⌂ Rented/Council` on door 4), map legend all match. Harness check added and passed.
  - Every write through `lib/sync/queue.ts`: **PASS** — no `supabase.from(` / `supabase.rpc(` under `components/` or `app/(field)/`.
  - `grep navigator.geolocation`: **PASS** — zero call sites. Remaining hit is a prohibition comment in `lib/field/position.ts`.
  - Seams after mini-map removal: **PASS** — `route-line` and `you-are-here` still registered in `field-map.tsx` load (empty source / `visibility: none`). `getSequence` / `SEQUENCE_IS_ROUTE_DERIVED` untouched; out-of-order banner still shown. Header instruction and teammate slots still return null. Cursor still in `lib/field/cursor.ts`.
  - Snapshot ordering untouched: **PASS**.
  - 8b original logging/undo/offline items: not re-run this pass; previous session PASSed them. Harness `verify-stage-8b.ts --keep` ALL CHECKS PASSED this session, then `--cleanup`. Did not start Stage 9 or 14.
- **Deviations from brief:** Logger ASCII still shows the mini map; the 2026-09-18 note records the replacement rather than rewriting the diagram. Immediate on the Leads tab is derived with `isSameLondonDay` for display because the outbox payload must not carry `is_immediate`. Attribution control is closed on `load` so it starts as ⓘ even on a wide desktop viewport.
- **Not done / deferred:** Stage 9, Stage 14, Track B service-worker tile cache (the known basemap limitation). No schema change. No 2,000-door test. Not re-tested on the physical phone that found the defects — desktop Chromium plus a 390×844 emulation only.
- **Follow-ups:** Re-test Show on map on the same real phone. Proper offline tiles remain Track B. Harness fixtures from this pass were cleaned up.


