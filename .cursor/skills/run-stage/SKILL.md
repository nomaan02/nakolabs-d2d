---
name: run-stage
description: Run one numbered build stage from docs/D2D-Build-Brief.md, end to end, with acceptance verification. Use whenever the user asks to implement, build or start a stage.
---

# Run a build stage

## Before writing any code

1. Read `docs/D2D-Build-Brief.md` sections 0 (agent instructions), 2 (glossary) and 3 (invariants).
2. Read the full text of the stage being implemented, including any dated amendment notes under it.
3. Restate back, in three or four lines: what this stage builds, what it must not touch, and the acceptance criteria.
4. If the stage depends on something a previous stage should have built, verify it exists before starting. Do not assume.

## While building

- Implement ONLY this stage. Do not scaffold the next one.
- If you find yourself needing something outside the stage's scope, stop and say so rather than quietly widening it.
- Schema changes go in one new numbered migration. List `supabase/migrations/` for the next free number. Never edit an applied one.
- Completed stages are amended with a dated note under that stage, never rewritten as though the new wording had always been there. If this stage's work forces a change to an already-completed stage, add the dated note; do not edit the completed body.

## Finishing

1. Work through the stage's acceptance checklist item by item.
2. Report each as PASS, FAIL, or NOT VERIFIED — and be honest about the third. "It should work" is NOT VERIFIED.
3. Append an entry to `docs/BUILD-LOG.md` using the format at the top of that file.
4. Say plainly what you did NOT do, and anything you deviated from.

Do not begin the next stage. End your turn.