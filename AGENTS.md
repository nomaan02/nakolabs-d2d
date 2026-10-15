# nakolabs-d2d

Canvassing management platform. Next.js 15 App Router, TypeScript, Tailwind,
Supabase (Postgres + PostGIS + Auth), MapLibre GL JS, MapTiler tiles,
Terra Draw, Dexie, Vercel.

## Hard rules

- Coverage is DERIVED from `knock_events`. Never create a coverage table.
- No scoring, ranking or quality signals in any `/field` route. Admin only.
  Eligibility facts (NCCZ, `do_not_call`, `no_opportunity`) may persist in
  `/field`. Quality signals may not. Current-assignment outcome colour is
  permitted; previous-visit outcome colour is not.
- All field writes go through `lib/sync/queue.ts`. Never a second sync path.
- Every table has RLS enabled with default-deny policies.
- PostGIS columns are `geometry(Point,4326)` / `geometry(Polygon,4326)`.
  Cast `::geography` for distances only.
- Every client-originated write carries a `client_event_id` (uuid v4, generated
  on device). Re-sync must be idempotent.
- Routes are deterministic, never solved for optimal. Same prop + visit_number
  must always produce the identical route.
- Duos bunny-hop: same side, same route, leapfrogging door to door. No side
  split, no per-canvasser door allocation. Do not redesign this.
- Raw GPS coordinates never leave the device. Only a distance-along-route
  scalar is ever transmitted or stored.
- Service role key is server-only. Never in a `NEXT_PUBLIC_` var.
- British English in user-facing strings.
- UPRN is the only door identity. A house number may be typed against an
  ALREADY-SELECTED UPRN and stored in `address_observations`. Address search,
  autocomplete, street/postcode entry and address-as-identifier remain banned.
- `property_addresses` is a separate table. Never denormalise
  `house_number`, `street_name`, `building_name` or `sub_building` into
  `properties`, `knock_events`, `leads` or `uprn_snapshot`.
- Later ingest passes never overwrite a higher-confidence earlier pass.
- `knock_events.outcome` has nine values. The ninth is `no_opportunity`.
- Latest-outcome-wins: corrections are new rows, resolved by `v_latest_knock`.
  Canvassers have no UPDATE or DELETE on `knock_events` or `leads`.
- No `navigator.geolocation` anywhere before Stage 16.
- Every view over an RLS table is created with `(security_invoker = true)`.
- CRM data (owner 2026-10-10, written OK from work): the company CRM is
  READ-ONLY. Only `lib/crm/client.ts` calls it, and only with `getchallenge`,
  `login`, `listtypes`, `describe`, `query` (SELECT) and `logout`. Never
  create, update, delete, revise or convert anything in the CRM.
  `CRM_USER` / `CRM_API_KEY` are server-only, never `NEXT_PUBLIC_`.
- `crm_leads` never stores names, phones, street text, house numbers, notes or
  best time to call (call-back details live only in `crm_contacts`, below). Canvasser = tidied first name only. The CRM street and
  house number are used once, server-side, to find the door (the one allowed
  exception to address-as-identifier), then dropped.
- CRM sale price (owner 2026-10-11): since about Nov 2025 the price is typed
  into the free-text "Result" (`cf_867`) or "Rep Result" (`cf_881`) box.
  Only `lib/crm/parse.ts` reads them, server-side, for Sold leads only, and
  keeps only the price number (`sale_amount`). For pricing the text is never
  stored, logged or returned (call-back leads keep Result, CRM-6 B, below).
- CRM sync schedule (owner 2026-10-11): Supabase pg_cron (migration 036)
  calls `/api/cron/crm-sync` every 30 minutes, about 05:00 to 21:00 London.
  The route needs `Authorization: Bearer <CRON_SECRET>` and replies with
  counts only. The URL and secret live in Supabase Vault (`crm_sync_url`,
  `crm_sync_secret`) and in Vercel env, never in the repo.
- CRM outcomes are previous-visit quality signals: admin and office only,
  never in any `/field` route, EXCEPT the P4b exceptions below.
- P4b canvasser CRM views (owner 2026-10-11): a canvasser may see their OWN
  CRM leads (matched by `profiles.crm_name` + `crm_branch`), the Bristol
  leaderboard (leads, sold, pitched, £ for everyone) and their call-back list
  in `/field`. These are the only ranking/quality signals allowed in `/field`.
  Previous-visit outcome colour on the map stays banned, with ONE exception
  (owner 2026-10-12): the Map tab's "My CRM leads" layer — the canvasser's
  own CRM leads as rings coloured by CRM outcome, OFF by default, switched on
  by the canvasser (`components/field/crm/crm-map-layer.tsx`).
- Call-back contacts (owner 2026-10-11, Wayne to OK before go-live): for
  call-back leads only, `crm_contacts` stores title, surname and phone /
  alt phone. Never first name or email. Readable only by
  the lead's own canvasser (not admin, not office). Rows are deleted 90 days
  after the lead was created (pg_cron `crm-contacts-purge`, migration 037).
  Only `lib/crm/parse.ts` reads `cf_877`, `lastname`, `phone`, `cf_1014`.
- Call-back details (owner 2026-10-13, CRM-6 B, migration 038): for call-back
  leads only, `crm_contacts` also keeps the CRM address line (`lane`) and the
  notes as typed: Result (`cf_867`), Product Interest (`cf_871`), Best Time To
  Call (`cf_1016`) and Description. Same rows, same rules: own canvasser
  only, 90-day purge. For any other lead `lib/crm/parse.ts` drops them. Rep
  Result is never stored. They appear only in the expanded call-back row.
- This week + Refresh from CRM (owner 2026-10-15, CRM-7, migration 042,
  Wayne OK'd): the Leads tab's "This week" view shows the canvasser's OWN CRM
  leads for the London week with the same details as the call-backs. So
  `crm_contacts` (title, surname, phone / alt phone, CRM address line, Result,
  Product Interest, Best Time To Call, Description) now holds a row for EVERY
  lead booked in the last 90 days, not only call-backs. Same rules: own
  canvasser only, never first name or email, Rep Result never stored, deleted
  90 days after the lead date. A Sold lead's Result box can hold the price as
  typed; it is kept like any Result note. The canvasser's "Refresh from CRM"
  button posts to `/api/crm/refresh-mine`: a server-side pull (read-only CRM
  client, this canvasser's leads for this week only, no `crm_sync_runs` row),
  throttled to one per canvasser per 30 seconds and one at a time overall
  (`crm_refresh_log`, service role only). It is a pull, not a field write: it
  sends no canvasser data and carries no `client_event_id`. Status words use
  the CRM colours: UTC yellow, Re-App purple, Blowout red, Booked (confirmed)
  blue.
- Call-back reason (owner 2026-10-11): `crm_leads.callback_reason` is a label
  worked out in `lib/crm/parse.ts` from status plus Result / Rep Result
  keywords. TITC, RITC, cancelled, not interested, changed mind, wrong number
  and already-done always mean no call-back. The note text is never stored in
  `crm_leads` (call-back leads keep it in `crm_contacts`, CRM-6 B).
- Call results (`crm_callbacks`) are written from the field through
  `lib/sync/queue.ts` only (op `crm_callback`), insert-only, never sent to
  the CRM.

## Structure

app/(admin)   — prop drawing, allocation, coverage, dashboard
app/(office)  — appointment slots, CRM sync review, manual lead settlement fallback
lib/crm       — the only CRM caller (read-only client, matcher, sync); server-only
app/(field)   — canvasser view; offline-capable; four tabs: Map, Logger, Leads, Profile
lib/supabase  — client + server factories, generated types
lib/sync      — Dexie queue, the only write path from the field
lib/geo       — PostGIS RPC wrappers, rotation and route maths
supabase/migrations — append-only, numbered
scripts/ingest-addresses.ts — address-label ingest (Stage 1c; `--pass=epc` first)

## Vocabulary

prop = one polygon = one team for one day (table: `territories` + `assignments`)
team = 1 to 3 canvassers, bunny-hopping the same route (tables: `assignments` + `assignment_members`)
lead outcomes: sale | pm (pitch & miss) | blowout | utc (unable to contact) | btc (back to canvasser) | re_app (rescheduled — non-terminal)
address label = house number + street displayed beside a dot; may be absent
match_confidence = exact | inferred | spatial_approx | street_only
no_opportunity = rented, council or HMO — "we cannot do the job here".
  Written to `knock_events.outcome` AND `property_observations.tenure`.

## Conventions

- Server Components by default. `"use client"` only where hooks or maps require it.
- Supabase types generated to `lib/supabase/types.ts`; regenerate after every migration.
- No component library. Tailwind only.
- Field UI targets one-handed phone use: minimum 44px tap targets, bottom-anchored actions.
- After a major change, update `docs/CLAUDE-HANDOFF.md` as `.cursor/rules/10-claude-handoff.mdc` requires.

## UI/UX skills

Taste, a11y, bans, voice, and icon library for this project live in `.ux-profile.md`.
Run `setup-ui-ux-skills` again only to change those defaults.
Before UI or microcopy work, read `.ux-profile.md`, then the matching domain skill (page-patterns, viewports, forms, surfaces, loaders, empty-states, copy, motion).
Before creating a new page, read `page-patterns` and name the pattern. Do not write page markup until the pattern is named.
Layouts must pass `viewports` at 375px and 1280px.
Before finishing UI, run `ux-audit`.
