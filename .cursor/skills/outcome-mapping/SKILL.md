---
name: outcome-mapping
description: Map a canvasser knock outcome when logging a door, recording a lead, tenure, no_opportunity, is_immediate, latest wins, or correcting a log.
---

# Knock outcome mapping

Use this whenever the field app logs a door, creates a lead, records tenure, writes `no_opportunity`, derives `is_immediate`, applies latest-wins, or corrects a log.

## Canonical button-to-enum mapping

| Button | `knock_events.outcome` | Also writes |
|---|---|---|
| Lead | `lead` | `leads` row |
| Contact | `answered` | — |
| No Answer | `no_answer` | — |
| Rented/Council | `no_opportunity` | `property_observations`, `tenure='no_opportunity'` |
| Other → | `refused` · `do_not_call` · `inaccessible` · `callback` | — |

`do_not_call` is a real enum value under Other and is NEVER free text. It is the one outcome with a compliance consequence and must stay queryable.

## Latest-outcome-wins

A correction is a NEW `knock_events` row with a NEW `client_event_id`. Never an UPDATE, never a DELETE. `v_latest_knock` resolves which row is current.

Canvassers have no UPDATE or DELETE on `knock_events` or `leads`.

## `is_immediate`

`is_immediate` is derived by a database trigger (`leads_set_is_immediate`) and must NEVER appear in a client payload. The trigger compares `booked_for` to the knock's `occurred_at` in `Europe/London`. Do not send `now()`.

## Narrow lead insert type

Construct every canvasser-originated lead payload through this type, not the raw generated `LeadsInsert`:

```ts
Pick<LeadsInsert, 'id'|'client_event_id'|'knock_event_id'|'uprn'|'canvasser_id'|'booked_for'|'notes'>
```

`is_immediate` is EXCLUDED from that Pick because the trigger owns it.

`id` and `client_event_id` are generated on the device. For a lead, the knock row and the lead row share ONE `client_event_id`, generated once at the Lead tap and reused on submit.
