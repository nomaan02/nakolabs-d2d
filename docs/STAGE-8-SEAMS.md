# Stage 8 seams

Stage 8b's acceptance checklist requires every row below to be ticked.

Each seam ships in Stage 8 with a safe default. A later stage swaps the source and touches nothing else. Source: brief amendments H (Stage 5b) and I (Stage 16), plus the cursor and teammate-line slots named in the Stage 8 redesign.

- [x] **`getSequence()`** — `lib/field/sequence.ts` — Stage 8: returns `uprn_snapshot` order — swapped by Stage 5b to route-derived order
- [x] **`SEQUENCE_IS_ROUTE_DERIVED`** — `lib/field/sequence.ts` — Stage 8: `false` — swapped by Stage 5b to `true`
- [x] **map layer id `route-line`** — `components/field/field-map.tsx` — Stage 8: registered, renders nothing — swapped by Stage 5b to `route_geom`
- [x] **`getCurrentStreetLabel()`** — `lib/field/sequence.ts` — Stage 8: street from `v_door_label` — swapped by Stage 5b to `route_steps.street_name`
- [x] **header instruction slot** — logger header — Stage 8: renders nothing — swapped by Stage 5b to spur / crossing text
- [x] **out-of-order banner** — Logger tab — Stage 8: shown while `SEQUENCE_IS_ROUTE_DERIVED` is `false` — swapped by Stage 5b: auto-hides
- [x] **`getRoutePosition()`** — `lib/field/position.ts` — Stage 8: returns `null` — swapped by Stage 16 to snapped scalar
- [x] **logger auto-advance** — Logger tab — Stage 8: disabled while `getRoutePosition()` is null — swapped by Stage 16: enabled on opt-in
- [x] **`positionEnabled`** — `lib/field/position.ts` — Stage 8: client-side, default `false` — swapped by Stage 16 to per-assignment opt-in
- [x] **map layer id `you-are-here`** — `components/field/field-map.tsx` — Stage 8: registered, hidden — swapped by Stage 16 to live marker
- [x] **current-door cursor** — `lib/field/cursor.ts` — Stage 8: owns current-door state — swapped by Stage 10, which wraps claims around it
- [x] **teammate line slot** — logger header — Stage 8: renders nothing — swapped by Stage 10
