---
name: new-migration
description: Create a database migration with correct numbering, RLS policies and type regeneration. Use for any change to the Postgres schema — new table, new column, new index, new policy.
---

# New migration

## Never
- Edit a migration that has already been applied. Write a new one.
- Guess the next file number. List `supabase/migrations/` and take the next free number from the directory. Never assume it from this skill, from the brief, or from memory. `003_core.sql` is applied; do not edit it.
- Add a table without RLS in the same migration.
- Use `geography` as a column type.
- Denormalise `house_number`, `street_name`, `building_name` or `sub_building` onto `properties`, `knock_events`, `leads`, or into `uprn_snapshot`. Address text lives in `property_addresses` only.

## Steps

1. List `supabase/migrations/` and take the next free number from that listing.
2. Name it `NNN_short_description.sql`.
3. Write the DDL.
4. In the SAME file: `alter table <name> enable row level security;`
5. In the SAME file: policies. Default deny — no policy means no access, and that is the correct starting point. For ordinary tables, write explicit policies for admin, office and canvasser. For reference data (`properties`, `nccz_zones`, `property_addresses`): SELECT for `authenticated` only, **no write policy**. Ingest uses the service role, which bypasses RLS; a write policy here is a false sense of control.
6. GiST index on any geometry column. B-tree on any foreign key used in a join.
7. Apply the migration.
8. Regenerate `lib/supabase/types.ts`.
9. Confirm the project still type-checks.
10. State which policies you wrote and which roles they grant.

## Verification

Do not report a migration as done until you have confirmed, with an actual query using a canvasser-role JWT, that the policies deny what they are supposed to deny. Reading the policy text back is not verification.

## Testing RLS without real auth

Auth may not exist yet. Simulate a role in a transaction instead of assuming:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<test-uuid>","role":"authenticated"}';
-- run the query that SHOULD be denied
rollback;
```

A policy read back in prose is not a test. Run the query and show the result.

## Column-level restrictions

RLS is row-level only. To stop a role updating specific columns, use
`grant update (col_a, col_b) on <table> to <role>` — or a trigger.
A row policy cannot do this. Never claim it does.