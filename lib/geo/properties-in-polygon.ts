import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { ringToEwkt, type Ring } from "@/lib/geo/prop-polygon";
import { mapPropRpcError, type PropFailureResult } from "@/lib/geo/rpc-error";

/** What each door feature carries. Never summed — the count comes from count_knockable. */
export type DoorProperties = { uprn: number; is_nccz: boolean };

export type DoorCollection = GeoJSON.FeatureCollection<GeoJSON.Point, DoorProperties>;

/** How many dots the map will draw at most. A larger prop still counts in full. */
export const DOT_CAP = 3000;

export type DoorsResult = { ok: true; doors: DoorCollection } | PropFailureResult;

/**
 * Fetches the doors inside a prop, already shaped as a GeoJSON
 * FeatureCollection for a MapLibre source.
 *
 * Call this only after `countKnockable` has succeeded on the same ring. The
 * polygon is validated once, by `assert_prop_polygon`; a shape that failed the
 * count has no business being drawn, and validating in two places invites the
 * two answers to drift.
 *
 * The collection may hold fewer features than the prop has doors. The caller
 * compares `doors.features.length` with `count.total` and says so on screen —
 * a truncated map must never quietly disagree with the count.
 */
export async function propertiesInPolygon(
  supabase: SupabaseClient<Database>,
  ring: Ring,
  cap: number = DOT_CAP,
): Promise<DoorsResult> {
  const { data, error } = await supabase.rpc("properties_in_polygon", {
    poly: ringToEwkt(ring),
    cap,
  });

  if (error) return mapPropRpcError(error);

  const collection = data as unknown as DoorCollection | null;
  if (!collection || collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    return {
      ok: false,
      code: "unavailable",
      message: "The doors could not be drawn. Check your connection and try again.",
      detail: "properties_in_polygon did not return a FeatureCollection",
    };
  }

  return { ok: true, doors: collection };
}
