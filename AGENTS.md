# nakolabs-d2d

Canvassing management platform. Next.js 15 App Router, TypeScript, Tailwind,
Supabase (Postgres + PostGIS + Auth), MapLibre GL JS, MapTiler tiles,
Terra Draw, Dexie, Vercel.

## Hard rules

- Coverage is DERIVED from `knock_events`. Never create a coverage table.
- No scoring, ranking or colour-coding in any `/field` route. Admin only.
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

## Structure

app/(admin)   — prop drawing, allocation, coverage, dashboard
app/(office)  — appointment slots, CRM sync review, manual lead settlement fallback
app/(field)   — canvasser view; offline-capable
lib/supabase  — client + server factories, generated types
lib/sync      — Dexie queue, the only write path from the field
lib/geo       — PostGIS RPC wrappers, rotation and route maths
supabase/migrations — append-only, numbered

## Vocabulary

prop = one polygon = one team for one day (table: `territories` + `assignments`)
team = 1 or 2 canvassers, bunny-hopping the same route (tables: `assignments` + `assignment_members`)
lead outcomes: sale | pm (pitch & miss) | blowout | utc (unable to contact) | btc (back to canvasser) | re_app (rescheduled — non-terminal)

## Conventions

- Server Components by default. `"use client"` only where hooks or maps require it.
- Supabase types generated to `lib/supabase/types.ts`; regenerate after every migration.
- No component library. Tailwind only.
- Field UI targets one-handed phone use: minimum 44px tap targets, bottom-anchored actions.