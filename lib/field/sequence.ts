import type { CachedAddress } from "@/lib/field/db";
import type { DoorCollection } from "@/lib/geo/todays-assignment";

/**
 * SEAM (Stage 5b). The walking order the Logger cursor steps through.
 *
 * Stage 8: `uprn_snapshot` order, which until Stage 5b is the interim angular
 * sweep from the prop centroid. House numbers therefore appear out of
 * sequence — 14, 2, 40, 8 — and that is the placeholder working as specified,
 * not a bug. The Logger says so on screen while `sequenceIsRouteDerived` is
 * false for this assignment.
 *
 * Stage 5b-a already writes that order into `uprn_snapshot` when it commits a
 * route, so `getSequence()` still reads the snapshot. An unrouted assignment
 * keeps the angular sweep. The per-assignment flag is `route_geom is not null`.
 */

export type SequenceDoor = {
  uprn: number;
  /** Zero-based index into the walk. `sequence_position` on the knock. */
  position: number;
  lngLat: [number, number];
};

/**
 * Per assignment, not a global constant. True when this assignment has a
 * `route_geom`. An unrouted prop keeps the interim-sweep banner.
 *
 * Gates the out-of-order banner. Auto-advance stays with `getRoutePosition()`
 * (Stage 16) and is not switched on here.
 */
export function sequenceIsRouteDerived(hasRoute: boolean): boolean {
  return hasRoute;
}

const NOT_A_STREET = new Set(["service road", "unnamed road"]);

function namedStreet(value: string | null | undefined): string | null {
  const street = value?.trim();
  if (!street) return null;
  if (NOT_A_STREET.has(street.toLowerCase())) return null;
  return street;
}

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
 * doors. On a routed assignment the street is `route_steps.street_name`.
 * That column is null on unnamed service roads — 215 of Northville's doors —
 * and the plate then falls back to this door's `v_door_label` street.
 * "service road" and "unnamed road" are instruction vocabulary, never a
 * street on the plate.
 */
export function getCurrentStreetLabel(
  label: CachedAddress | undefined,
  routeStreet?: string | null,
  routed = false,
): string | null {
  if (routed) {
    const fromRoute = namedStreet(routeStreet);
    if (fromRoute) return fromRoute;
  }
  return namedStreet(label?.street_name);
}
