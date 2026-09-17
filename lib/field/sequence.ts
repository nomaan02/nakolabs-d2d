import type { CachedAddress } from "@/lib/field/db";
import type { DoorCollection } from "@/lib/geo/todays-assignment";

/**
 * SEAM (Stage 5b). The walking order the Logger cursor steps through.
 *
 * Stage 8: `uprn_snapshot` order, which until Stage 5b is the interim angular
 * sweep from the prop centroid. House numbers therefore appear out of
 * sequence — 14, 2, 40, 8 — and that is the placeholder working as specified,
 * not a bug. The Logger says so on screen; see `SEQUENCE_IS_ROUTE_DERIVED`.
 *
 * Stage 5b swaps the body of `getSequence()` for route-derived order and
 * flips the flag. Nothing else in the Logger changes.
 */

export type SequenceDoor = {
  uprn: number;
  /** Zero-based index into the walk. `sequence_position` on the knock. */
  position: number;
  lngLat: [number, number];
};

/**
 * Stage 8: `false` — the sequence is the interim sweep.
 * Stage 5b: `true` — the sequence follows the route.
 *
 * Gates the out-of-order banner and, with `getRoutePosition()`, auto-advance.
 */
export const SEQUENCE_IS_ROUTE_DERIVED = false;

/**
 * Stage 8: `uprn_snapshot` order, which the RPC already encodes as
 * `properties.sequence` on each door feature. Sorted rather than trusted to
 * arrive ordered, because the order IS the product here.
 */
export function getSequence(doors: DoorCollection): SequenceDoor[] {
  return doors.features
    .map((feature) => ({
      uprn: feature.properties.uprn,
      position: feature.properties.sequence,
      lngLat: [feature.geometry.coordinates[0], feature.geometry.coordinates[1]] as [
        number,
        number,
      ],
    }))
    .sort((a, b) => a.position - b.position);
}

/**
 * SEAM (Stage 5b). The street the canvasser is standing on.
 *
 * Stage 8: the street on the current door's `v_door_label` row, which is
 * whatever the address ingest resolved and is absent for roughly 40% of
 * doors. Stage 5b swaps this for `route_steps.street_name`, which is known
 * for every step because the route is built from the road network.
 */
export function getCurrentStreetLabel(label: CachedAddress | undefined): string | null {
  const street = label?.street_name?.trim();
  return street ? street : null;
}
