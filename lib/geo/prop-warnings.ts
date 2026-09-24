import type { KnockableCount } from "@/lib/geo/count-knockable";

export type PropWarning = {
  code: "a_road";
  message: string;
};

// TODO: warn when a prop boundary crosses an A-road.
// Stage 4 deferred this until classified roads existed. `road_segments` now
// has a `highway` column (Stage 1b), but the check is still not this stage's
// job. Deliberately not stubbed: a check that always answers "no A-road
// crossed" is indistinguishable from a passing check.

/**
 * Soft warnings on a counted prop. The 150-door shift warning was removed
 * in Stage 5b-R3 — a duo shift works well past that — so this returns
 * nothing until the A-road check exists. Never a block.
 */
export function propWarnings(count: KnockableCount): PropWarning[] {
  void count;
  return [];
}
