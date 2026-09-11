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
