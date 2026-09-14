/** A single position, `[longitude, latitude]` in EPSG:4326 — GeoJSON order. */
export type Position = [number, number];

/** The outer ring of a prop polygon. Props have no holes. */
export type Ring = Position[];

/**
 * The walk-list window canvassing practice converges on: roughly 40 to 150
 * doors for a one-to-two-hour shift. `max` drives a soft warning, never a
 * block — the admin knows things the boundary does not.
 */
export const SHIFT_DOORS = { min: 40, max: 150 } as const;

/** Decimal places kept in the WKT. 7 dp is about 1cm at this latitude. */
const PRECISION = 7;

export type RingProblem = "too_few_points" | "not_a_number" | "out_of_range";

export const RING_PROBLEM_MESSAGES: Record<RingProblem, string> = {
  too_few_points: "A prop needs at least three corners.",
  not_a_number: "That shape has a corner the map could not read. Redraw it.",
  out_of_range: "That shape has a corner off the edge of the world. Redraw it.",
};

/** Drops positions that repeat the one before them. */
function withoutRepeats(ring: Ring): Ring {
  return ring.filter(
    (position, index) =>
      index === 0 ||
      position[0] !== ring[index - 1][0] ||
      position[1] !== ring[index - 1][1],
  );
}

/**
 * Checks a ring is well formed enough to reach Postgres. Validity in the OGC
 * sense — self-intersection especially — is decided by `ST_IsValid` in
 * `count_knockable`, not here. This only stops a string that the geometry
 * parser would choke on, which would surface as an opaque server error rather
 * than a message an admin can act on.
 */
export function ringProblem(ring: Ring): RingProblem | null {
  const positions = withoutRepeats(ring);
  const open =
    positions.length > 1 &&
    positions[0][0] === positions[positions.length - 1][0] &&
    positions[0][1] === positions[positions.length - 1][1]
      ? positions.slice(0, -1)
      : positions;

  if (open.length < 3) return "too_few_points";

  for (const [lon, lat] of open) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return "not_a_number";
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return "out_of_range";
  }

  return null;
}

/**
 * Builds the extended WKT that both the count RPC and the `territories`
 * insert use, so the prop that gets counted is byte-for-byte the prop that
 * gets saved.
 */
export function ringToEwkt(ring: Ring): string {
  const positions = withoutRepeats(ring);
  const first = positions[0];
  const last = positions[positions.length - 1];
  const closed =
    first[0] === last[0] && first[1] === last[1]
      ? positions
      : [...positions, first];

  const coordinates = closed
    .map(([lon, lat]) => `${lon.toFixed(PRECISION)} ${lat.toFixed(PRECISION)}`)
    .join(",");

  return `SRID=4326;POLYGON((${coordinates}))`;
}
