import type { Ring } from "@/lib/geo/prop-polygon";
import type { SweepDirection } from "@/lib/geo/rotation";

/**
 * Stage 5 interim geometric UPRN ordering. Replaced by Stage 5b's route
 * traversal for new allocations. Already-frozen snapshots stay as they were.
 *
 * Same rule `allocate_prop` uses in SQL: angle from the prop centroid,
 * starting at `entryVertexIndex`, clockwise or anticlockwise per
 * `sweep_direction`, ties broken on ascending UPRN. This is the TypeScript
 * form that `scripts/verify-stage-5.ts` already checked against the RPC —
 * moved here so the demo seed imports it instead of growing a second copy.
 */

export type SweepDoor = {
  uprn: number;
  coord: [number, number];
};

function planarAzimuth(from: [number, number], to: [number, number]): number {
  const angle = Math.atan2(to[0] - from[0], to[1] - from[1]);
  return angle < 0 ? angle + 2 * Math.PI : angle;
}

function relativeAngle(azimuth: number, entryAzimuth: number, direction: SweepDirection): number {
  const twoPi = 2 * Math.PI;
  const raw = direction === "cw" ? azimuth - entryAzimuth : entryAzimuth - azimuth;
  return ((raw % twoPi) + twoPi) % twoPi;
}

export function centroidOf(ring: Ring): [number, number] {
  const vertices = uniqueVertices(ring);
  const lon = vertices.reduce((sum, p) => sum + p[0], 0) / vertices.length;
  const lat = vertices.reduce((sum, p) => sum + p[1], 0) / vertices.length;
  return [lon, lat];
}

/** Distinct corners. The closing vertex that repeats the first is dropped. */
export function uniqueVertices(ring: Ring): Ring {
  const open =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  return open;
}

/**
 * Knockable UPRNs in Stage 5 placeholder walk order. NCCZ exclusion is the
 * caller's job — pass only knockable doors.
 */
export function orderKnockableBySweep(
  doors: SweepDoor[],
  ring: Ring,
  entryVertexIndex: number,
  direction: SweepDirection,
): number[] {
  const centre = centroidOf(ring);
  const vertices = uniqueVertices(ring);
  if (entryVertexIndex < 0 || entryVertexIndex >= vertices.length) {
    throw new Error(`entry vertex ${entryVertexIndex} is outside a ${vertices.length}-corner prop.`);
  }
  const entry = vertices[entryVertexIndex];
  const entryAz = planarAzimuth(centre, entry);
  return [...doors]
    .map((door) => ({
      uprn: door.uprn,
      key: relativeAngle(planarAzimuth(centre, door.coord), entryAz, direction),
    }))
    .sort((a, b) => a.key - b.key || a.uprn - b.uprn)
    .map((row) => row.uprn);
}
