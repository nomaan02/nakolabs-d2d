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

## Address labels

Address text is a display label only. It is never written from the field. Do not enqueue it, do not put it on `knock_events` or `leads`, and do not add it to the assignment snapshot. `property_addresses` is read-only reference data (SELECT for authenticated, no write policy). Logging remains by UPRN.

## Red flags

- `supabase.from(...).insert(...)` inside anything under `app/(field)/` — wrong, use the queue.
- A new table for something that only needs to be true for the next 90 seconds — wrong, use broadcast.
- Any payload containing latitude or longitude leaving the device — wrong, see rule 00-core.
- Writing `house_number`, `street_name`, `building_name`, `sub_building` or any other address field from the field app — wrong. Labels are read-only.
- Address search, autocomplete, or a typed address input — wrong. Tapping the UPRN dot is the interaction.