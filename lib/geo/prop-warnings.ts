import { SHIFT_DOORS } from "@/lib/geo/prop-polygon";
import type { KnockableCount } from "@/lib/geo/count-knockable";

export type PropWarning = {
  code: "oversize";
  message: string;
};

// TODO (needs Stage 1b): warn when a prop boundary crosses an A-road.
// Section 6, Stage 4 asks for this alongside the size warning, but road
// classification only exists once the OSM road ingest has run — there is no
// `road_segments` table and no `highway` column in the database yet, so there
// is nothing to test a boundary against. Deliberately not stubbed: a check
// that always answers "no A-road crossed" is indistinguishable from a passing
// check, and would quietly stay wrong after Stage 1b lands. Add it here as a
// second warning code once `road_segments` exists, tested against a prop drawn
// across a known A-road (for example the A38 Gloucester Road).

/** Soft warnings on a counted prop. Never a block — save always stays available. */
export function propWarnings(count: KnockableCount): PropWarning[] {
  const warnings: PropWarning[] = [];

  if (count.knockable > SHIFT_DOORS.max) {
    warnings.push({
      code: "oversize",
      message:
        `${count.knockable.toLocaleString("en-GB")} knockable doors is above the ` +
        `${SHIFT_DOORS.max} a shift usually covers. Save it anyway if you know ` +
        `something the boundary does not.`,
    });
  }

  return warnings;
}
