# Stage 8 seams

Stage 8b shipped each seam with a safe default. A later stage swaps the source.

## Live — Stage 5b-b (2026-09-21)

- [x] **`getSequence()`** — `lib/field/sequence.ts` — still returns `uprn_snapshot` order. Stage 5b-a already writes that order from the route, so a routed assignment's snapshot is the walk. An unrouted assignment keeps the angular sweep. The function body did not need to change.
- [x] **`sequenceIsRouteDerived(hasRoute)`** — `lib/field/sequence.ts` — per assignment, true when `route_geom` is not null. The Stage 8 global constant is gone. An unrouted assignment keeps the banner.
- [x] **map layer id `route-line`** — `components/field/field-map.tsx` — populated from `route_geom`, drawn under the door circles.
- [x] **`getCurrentStreetLabel()`** — `lib/field/sequence.ts` — on a routed assignment, `route_steps.street_name`, then the door's `v_door_label` street when that name is null. "service road" is never shown on the plate.
- [x] **header instruction slot** — logger header — the current step's instruction. Consecutive spur steps are one card. Transfer steps render as "Walk across". Empty when the assignment is unrouted.
- [x] **out-of-order banner** — Logger tab — shown only when the assignment has no route. Still there for small and frozen props.

## Still pending

The slots below are still in the code from Stage 8. Their sources have not been swapped.

- [ ] **`getRoutePosition()`** — `lib/field/position.ts` — still returns `null`. Stage 16.
- [ ] **logger auto-advance** — Logger tab — still off while `getRoutePosition()` is null. Stage 16.
- [ ] **`positionEnabled`** — `lib/field/position.ts` — still client-side, default `false`. Stage 16.
- [ ] **map layer id `you-are-here`** — `components/field/field-map.tsx` — still registered and hidden. Stage 16.
- [ ] **current-door cursor** — `lib/field/cursor.ts` — still owns current-door state, with no claims wrapped around it. Stage 10.
- [ ] **teammate line slot** — logger header — still renders nothing. Stage 10.
