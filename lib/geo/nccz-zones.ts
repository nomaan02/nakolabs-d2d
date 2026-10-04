import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * UI-5 A3b. Every No Cold Calling Zone outline (migration 026,
 * `nccz_zones_geojson`). Fails open: any error gives an empty collection,
 * and the draw page simply shows no outlines.
 */
export async function fetchNcczZones(
  supabase: SupabaseClient<Database>,
): Promise<GeoJSON.FeatureCollection> {
  const { data, error } = await supabase.rpc("nccz_zones_geojson");
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return EMPTY;
  const collection = data as unknown as GeoJSON.FeatureCollection;
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) return EMPTY;
  return collection;
}
