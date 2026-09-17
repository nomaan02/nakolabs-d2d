---
name: field-write
description: Add a new write operation to the canvasser field app. Use whenever the field app needs to record something new — a knock, an observation, a claim, a status change.
---

# Adding a field write

Every write from the field app is offline-first. There are no exceptions and no "this one is simple enough to skip it" cases.

## Checklist

1. Does this need to persist, or is it ephemeral?
   - Persist → the queue, below.
   - Ephemeral (partner position, door claims) → Supabase Realtime **broadcast**. No table. Do not create one.
2. For persisted writes:
   - Generate a `client_event_id` (uuid v4) ON THE DEVICE, at the moment of the action.
   - Enqueue through `lib/sync/queue.ts`. No direct Supabase call from a field component.
   - Add a unique constraint on `client_event_id` in the target table.
   - Update local Dexie state immediately so the UI responds before sync.
3. Add the offline test: perform the action in airplane mode, reconnect, confirm exactly one row.
4. Add the duplicate test: replay the same `client_event_id`, confirm exactly one row.

## Ops

New ops go in `lib/sync/ops.ts` and are registered in `validateOp`. Never a parallel op system, never a second transport.

## Undo window

A newly logged op is written with status `held_undo` and an `eligible_at` field, promoted to `pending` after 60s. `flush()` selects only `pending`, so no change to the flush query is needed.

Undo = deleting a `held_undo` row. Nothing reaches Postgres.

A sweep on app start promotes any `held_undo` row whose `eligible_at` has passed.

## Address labels

Address text is a display label only. UPRN is the only door identity. A house number may be typed against an ALREADY-SELECTED UPRN and stored in `address_observations` via the queue as its own op type. Do not put address fields on `knock_events`, `leads`, or `uprn_snapshot`. `property_addresses` is ingest-owned (SELECT for authenticated, no write policy). Logging remains by UPRN.

## Red flags

- `supabase.from(...).insert(...)` inside anything under `app/(field)/` — wrong, use the queue.
- A new table for something that only needs to be true for the next 90 seconds — wrong, use broadcast.
- Any payload containing latitude or longitude leaving the device — wrong, see rule 00-core.
- Writing `house_number`, `street_name`, `building_name` or `sub_building` onto `knock_events`, `leads`, `properties` or `uprn_snapshot` — wrong.
- Address search, autocomplete, street/postcode entry, or typed text used to *locate* a property — wrong. Typing a house number against an already-selected UPRN is allowed.